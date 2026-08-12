package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"trustbank/ledger/internal/credential"
)

type ctxKey string

const tenantIDKey ctxKey = "tenantID"

// requireApiKey replaces the old requireSecret+requireTenant pair, which
// never cross-checked each other — any caller holding the one shared
// secret could claim any X-Tenant-Id. It verifies the bearer token
// against internal/credential, checks it carries at least minScope, and
// binds tenant context from the credential itself, not from a header the
// caller controls. See SERVICE_CREDENTIAL_MODEL.md (repo root).
func requireApiKey(pool *pgxpool.Pool, minScope credential.Scope, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if !strings.HasPrefix(auth, "Bearer ") {
			respondError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		token := strings.TrimPrefix(auth, "Bearer ")

		cred, err := credential.Verify(r.Context(), pool, token)
		if err != nil {
			respondError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if !scopeSatisfies(cred.Scope, minScope) {
			respondError(w, http.StatusForbidden, "insufficient scope")
			return
		}

		ctx := r.Context()

		if minScope != credential.ScopePlatformAdmin {
			// Issue() guarantees TenantID is non-nil for every non-platform-admin scope.
			tenantID := *cred.TenantID
			if headerTenant := r.Header.Get("X-Tenant-Id"); headerTenant != "" && headerTenant != tenantID {
				respondError(w, http.StatusForbidden, "token is not authorized for this tenant")
				return
			}
			ctx = context.WithValue(ctx, tenantIDKey, tenantID)
		}

		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// platform-admin satisfies anything (a bootstrap/operator credential, used
// rarely and never embedded in a running service); admin satisfies its
// own routes plus anything operate can do; operate satisfies only itself.
func scopeSatisfies(have, need credential.Scope) bool {
	if have == credential.ScopePlatformAdmin {
		return true
	}
	if have == need {
		return true
	}
	return have == credential.ScopeAdmin && need == credential.ScopeOperate
}

func tenantFromContext(ctx context.Context) (string, bool) {
	v, ok := ctx.Value(tenantIDKey).(string)
	return v, ok
}
