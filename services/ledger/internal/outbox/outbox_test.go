package outbox_test

// Real integration test — see internal/ledger/service_test.go's header
// comment for how to point DATABASE_URL at a migrated database.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/outbox"
	"trustbank/ledger/internal/tenant"
	"trustbank/ledger/internal/wallet"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		t.Skip("DATABASE_URL not set — skipping outbox integration tests")
	}
	pool, err := dbctx.NewPool(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestConsumer_DrainOnce_DeliversPendingEventToTenantWebhook(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	suffix := uuid.New().String()[:8]
	tn, _, err := tenant.Create(ctx, pool, tenant.CreateInput{
		Slug: "outbox-test-" + suffix, Name: "Outbox Test " + suffix,
		LicenseType: domain.BaaSReseller, BaseCurrency: "NGN", WebhookURL: server.URL,
	})
	if err != nil {
		t.Fatalf("create tenant: %v", err)
	}

	customerID := "customer-" + uuid.NewString()[:8]
	if _, err := wallet.OpenAccount(ctx, pool, wallet.OpenAccountInput{TenantID: tn.ID, ExternalCustomerID: customerID}); err != nil {
		t.Fatalf("open account: %v", err)
	}

	// Posting a deposit writes one event_outbox row transactionally.
	if _, err := wallet.ConfirmDeposit(ctx, pool, wallet.ConfirmDepositInput{
		TenantID: tn.ID, ExternalCustomerID: customerID, Amount: 1_000,
		Reference: "DEP-" + uuid.NewString(), IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("confirm deposit: %v", err)
	}

	consumer := outbox.NewConsumer(pool)
	if err := consumer.DrainOnce(ctx); err != nil {
		t.Fatalf("drain once: %v", err)
	}

	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected exactly 1 webhook delivery, got %d", got)
	}

	// A second drain should find nothing pending — no duplicate delivery.
	if err := consumer.DrainOnce(ctx); err != nil {
		t.Fatalf("second drain once: %v", err)
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected still exactly 1 webhook delivery after second drain, got %d", got)
	}
}
