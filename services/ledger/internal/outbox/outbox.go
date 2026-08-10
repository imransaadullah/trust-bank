// Package outbox drains the event_outbox table written transactionally
// by internal/ledger and delivers each event to the owning tenant's
// webhook URL. This is a deliberate scope-down from the architecture
// doc's Kafka recommendation — a single-process poller is the right size
// for one VPS and no ops team. The event_outbox table itself doesn't
// change if this gets swapped for a real broker later.
//
// Known limitations, accepted for now given the timeline: a failed
// delivery goes back to 'pending' and is retried on the next poll tick
// rather than with exponential backoff, and a process crash mid-batch
// leaves rows stuck at 'processing' with no reaper to reclaim them —
// fine running one process at MVP volume, worth revisiting before this
// carries meaningful traffic.
package outbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/dbctx"
)

const claimBatchSize = 20

type Consumer struct {
	pool       *pgxpool.Pool
	httpClient *http.Client
	pollEvery  time.Duration
}

func NewConsumer(pool *pgxpool.Pool) *Consumer {
	return &Consumer{
		pool:       pool,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		pollEvery:  5 * time.Second,
	}
}

// Run polls until ctx is cancelled. Meant to be started as a goroutine
// alongside the HTTP server — one process, one systemd unit.
func (c *Consumer) Run(ctx context.Context) {
	ticker := time.NewTicker(c.pollEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := c.DrainOnce(ctx); err != nil {
				log.Printf("outbox: drain error: %v", err)
			}
		}
	}
}

type event struct {
	ID         string
	EventType  string
	Payload    json.RawMessage
	RetryCount int
	MaxRetries int
}

type tenantWebhook struct {
	ID         string
	WebhookURL string
}

// DrainOnce runs a single drain cycle across every tenant with a webhook
// configured. Run calls this on a timer; tests call it directly.
func (c *Consumer) DrainOnce(ctx context.Context) error {
	tenants, err := c.listTenantsWithWebhooks(ctx)
	if err != nil {
		return fmt.Errorf("outbox: list tenants: %w", err)
	}
	for _, t := range tenants {
		if err := c.drainTenant(ctx, t.ID, t.WebhookURL); err != nil {
			log.Printf("outbox: tenant %s: %v", t.ID, err)
		}
	}
	return nil
}

// listTenantsWithWebhooks reads the tenants table directly — it isn't
// tenant-scoped data (it IS the tenant record), so this doesn't go
// through dbctx.WithTenant.
func (c *Consumer) listTenantsWithWebhooks(ctx context.Context) ([]tenantWebhook, error) {
	rows, err := c.pool.Query(ctx, `
		SELECT id, settings->>'webhookUrl'
		FROM tenants
		WHERE settings ? 'webhookUrl' AND status = 'ACTIVE'
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []tenantWebhook
	for rows.Next() {
		var t tenantWebhook
		if err := rows.Scan(&t.ID, &t.WebhookURL); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

func (c *Consumer) drainTenant(ctx context.Context, tenantID, webhookURL string) error {
	events, err := c.claimBatch(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("claim batch: %w", err)
	}

	for _, ev := range events {
		deliverErr := c.deliver(ctx, webhookURL, ev)
		if err := c.markResult(ctx, tenantID, ev, deliverErr); err != nil {
			log.Printf("outbox: mark result for event %s: %v", ev.ID, err)
		}
	}
	return nil
}

// claimBatch selects pending events and flips them to 'processing' in the
// same transaction, using SKIP LOCKED so a second worker process (or a
// future one) can't double-claim the same rows.
func (c *Consumer) claimBatch(ctx context.Context, tenantID string) ([]event, error) {
	var events []event
	err := dbctx.WithTenant(ctx, c.pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, event_type, payload, retry_count, max_retries
			FROM event_outbox
			WHERE tenant_id = $1 AND status = 'pending'
			ORDER BY created_at
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		`, tenantID, claimBatchSize)
		if err != nil {
			return err
		}

		for rows.Next() {
			var e event
			if err := rows.Scan(&e.ID, &e.EventType, &e.Payload, &e.RetryCount, &e.MaxRetries); err != nil {
				rows.Close()
				return err
			}
			events = append(events, e)
		}
		rowsErr := rows.Err()
		rows.Close()
		if rowsErr != nil {
			return rowsErr
		}

		if len(events) == 0 {
			return nil
		}
		ids := make([]string, len(events))
		for i, e := range events {
			ids[i] = e.ID
		}
		_, err = tx.Exec(ctx, `UPDATE event_outbox SET status = 'processing' WHERE id = ANY($1)`, ids)
		return err
	})
	return events, err
}

func (c *Consumer) deliver(ctx context.Context, webhookURL string, ev event) error {
	body, err := json.Marshal(map[string]any{
		"id": ev.ID, "eventType": ev.EventType, "payload": ev.Payload,
	})
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}
	return nil
}

func (c *Consumer) markResult(ctx context.Context, tenantID string, ev event, deliverErr error) error {
	return dbctx.WithTenant(ctx, c.pool, tenantID, func(ctx context.Context, tx pgx.Tx) error {
		if deliverErr == nil {
			_, err := tx.Exec(ctx, `
				UPDATE event_outbox SET status = 'delivered', delivered_at = now() WHERE id = $1
			`, ev.ID)
			return err
		}

		nextRetryCount := ev.RetryCount + 1
		status := "pending"
		if nextRetryCount >= ev.MaxRetries {
			status = "failed"
		}
		_, err := tx.Exec(ctx, `
			UPDATE event_outbox SET status = $1, retry_count = $2, last_error = $3 WHERE id = $4
		`, status, nextRetryCount, deliverErr.Error(), ev.ID)
		return err
	})
}
