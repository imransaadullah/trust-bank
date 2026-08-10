package httpapi

import (
	"encoding/json"
	"net/http"

	"trustbank/ledger/internal/domain"
	"trustbank/ledger/internal/tenant"
)

type createTenantRequest struct {
	Slug           string `json:"slug"`
	Name           string `json:"name"`
	LicenseType    string `json:"licenseType"`
	DeploymentMode string `json:"deploymentMode"`
	BaseCurrency   string `json:"baseCurrency"`
	WebhookURL     string `json:"webhookUrl"`
}

func (s *Server) handleCreateTenant(w http.ResponseWriter, r *http.Request) {
	var req createTenantRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Slug == "" || req.Name == "" || req.LicenseType == "" {
		respondError(w, http.StatusBadRequest, "slug, name, and licenseType are required")
		return
	}

	t, sysAccounts, err := tenant.Create(r.Context(), s.pool, tenant.CreateInput{
		Slug: req.Slug, Name: req.Name,
		LicenseType:    domain.LicenseType(req.LicenseType),
		DeploymentMode: domain.DeploymentMode(req.DeploymentMode),
		BaseCurrency:   req.BaseCurrency,
		WebhookURL:     req.WebhookURL,
	})
	if err != nil {
		respondError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"tenant": map[string]any{
			"id": t.ID, "slug": t.Slug, "name": t.Name,
			"licenseType": t.LicenseType, "deploymentMode": t.DeploymentMode, "baseCurrency": t.BaseCurrency,
		},
		"systemAccounts": map[string]any{
			"floatAccountId":     sysAccounts.Float.ID,
			"feeIncomeAccountId": sysAccounts.FeeIncome.ID,
		},
	})
}
