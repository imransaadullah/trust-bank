package httpapi

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey string

const tenantIDKey ctxKey = "tenantID"

// requireSecret is a placeholder for the tiered publishable/secret API key
// model described in AUTHCORE_SCOPED_CLIENT_KEY_SPEC.md — one static,
// unscoped secret for every caller. Do not expose this service outside a
// trusted network with only this in front of it.
func requireSecret(secret string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") || strings.TrimPrefix(auth, "Bearer ") != secret {
			respondError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireTenant(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.Header.Get("X-Tenant-Id")
		if tenantID == "" {
			respondError(w, http.StatusBadRequest, "missing X-Tenant-Id header")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), tenantIDKey, tenantID)))
	})
}

func tenantFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(tenantIDKey).(string)
	return v, ok
}
