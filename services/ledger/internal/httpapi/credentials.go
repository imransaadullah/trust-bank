package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"trustbank/ledger/internal/credential"
)

type issueCredentialRequest struct {
	Label string `json:"label"`
	Scope string `json:"scope"`
}

// The issuing admin credential's own tenant is what a new credential gets
// bound to — there is no way to specify a different tenant in the
// request body. An admin credential can only mint access for its own
// tenant, never anyone else's.
func (s *Server) handleIssueCredential(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantFromContext(r.Context())
	if !ok {
		respondError(w, http.StatusForbidden, "admin credentials must be tenant-bound")
		return
	}

	var req issueCredentialRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Label == "" {
		respondError(w, http.StatusBadRequest, "label is required")
		return
	}
	scope := credential.Scope(req.Scope)
	if scope != credential.ScopeAdmin && scope != credential.ScopeOperate {
		respondError(w, http.StatusBadRequest, "scope must be 'admin' or 'operate'")
		return
	}

	tid := tenantID
	c, token, err := credential.Issue(r.Context(), s.pool, credential.IssueInput{
		TenantID: &tid, Label: req.Label, Scope: scope,
	})
	if err != nil {
		respondError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"id": c.ID, "label": c.Label, "scope": c.Scope, "tokenPrefix": c.TokenPrefix,
		// The only time this ever appears in a response — store it now, it
		// cannot be retrieved again.
		"token": token,
	})
}

func (s *Server) handleListCredentials(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantFromContext(r.Context())
	if !ok {
		respondError(w, http.StatusForbidden, "admin credentials must be tenant-bound")
		return
	}

	creds, err := credential.List(r.Context(), s.pool, tenantID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]map[string]any, 0, len(creds))
	for _, c := range creds {
		out = append(out, map[string]any{
			"id": c.ID, "label": c.Label, "tokenPrefix": c.TokenPrefix, "scope": c.Scope,
			"status": c.Status, "createdAt": c.CreatedAt, "revokedAt": c.RevokedAt, "lastUsedAt": c.LastUsedAt,
		})
	}
	respondJSON(w, http.StatusOK, out)
}

func (s *Server) handleRevokeCredential(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := tenantFromContext(r.Context())
	if !ok {
		respondError(w, http.StatusForbidden, "admin credentials must be tenant-bound")
		return
	}

	credID := r.PathValue("credId")
	if err := credential.Revoke(r.Context(), s.pool, tenantID, credID); err != nil {
		if errors.Is(err, credential.ErrNotFound) {
			respondError(w, http.StatusNotFound, "credential not found")
			return
		}
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
