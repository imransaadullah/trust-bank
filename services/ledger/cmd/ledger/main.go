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
	"trustbank/ledger/internal/tlsconfig"
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

	handler := httpapi.NewServer(pool)
	server := &http.Server{Addr: cfg.BindHost + ":" + cfg.Port, Handler: handler}

	tlsCfg, err := tlsconfig.ServerConfig(cfg)
	if err != nil {
		log.Fatalf("tlsconfig: %v", err)
	}

	go func() {
		if tlsCfg != nil {
			server.TLSConfig = tlsCfg
			log.Printf("ledger service listening on %s:%s (mTLS required)", cfg.BindHost, cfg.Port)
			// Empty cert/key paths — already loaded into server.TLSConfig above.
			if err := server.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Fatalf("https: %v", err)
			}
			return
		}
		log.Printf("ledger service listening on %s:%s", cfg.BindHost, cfg.Port)
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
