// Command ledger runs the core ledger HTTP service.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"trustbank/ledger/internal/accrual"
	"trustbank/ledger/internal/config"
	"trustbank/ledger/internal/dbctx"
	"trustbank/ledger/internal/httpapi"
	"trustbank/ledger/internal/outbox"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	pool, err := dbctx.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	go outbox.NewConsumer(pool).Run(ctx)
	go accrual.NewConsumer(pool, cfg.AccrualPollInterval).Run(ctx)

	handler := httpapi.NewServer(pool, cfg.SharedSecret)
	server := &http.Server{Addr: ":" + cfg.Port, Handler: handler}

	go func() {
		log.Printf("ledger service listening on :%s", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}
