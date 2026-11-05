// Official provider onboarding catalog for owner-controlled API credentials.
// Catalog metadata contains no credentials and never authorizes paid usage.
const freeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

export const PROVIDER_CATALOG = freeze([
  {
    id: "nvidia_build",
    name: "NVIDIA Build / NIM API Catalog",
    signupUrl: "https://build.nvidia.com/",
    keyManagementUrl: "https://build.nvidia.com/settings/keys",
    documentationUrl: "https://docs.nvidia.com/ngc/latest/ngc-user-guide.html",
    authentication: { scheme: "bearer", header: "Authorization" },
    acquisition: {
      initialSignup: "owner_manual",
      keyIssue: "dashboard",
      keyRotation: "dashboard_assisted",
      publicKeyIssuanceApiVerified: false,
      browserSessionAutomation: "disabled_pending_provider_specific_review",
      automaticSignup: false
    },
    lifecycle: {
      expiry: "owner_selected_at_creation",
      rotationSupportedInDashboard: true,
      personalKeyLimit: 8,
      secretShownOnlyAtCreation: true,
      oldKeyCanRemainActiveDuringTransition: true,
      recommendedRotationDays: 90
    },
    freeUse: {
      program: "free_serverless_trial_endpoints",
      requiresPerModelFreeConfirmation: true,
      paidUpgradeAllowed: false,
      autoBillingAllowed: false,
      usageSource: "model_endpoint_policy_and_response_metadata"
    }
  },
  {
    id: "bytez",
    name: "Bytez Model API",
    signupUrl: "https://bytez.com/",
    keyManagementUrl: "https://bytez.com/api/billing",
    documentationUrl: "https://github.com/Bytez-com/docs",
    billingDocumentationUrl: "https://github.com/Bytez-com/docs/blob/main/docs/model-api/docs/billing.mdx",
    authentication: { scheme: "raw_key", header: "Authorization" },
    acquisition: {
      initialSignup: "owner_manual",
      keyIssue: "dashboard",
      keyRotation: "dashboard_assisted",
      publicKeyIssuanceApiVerified: false,
      browserSessionAutomation: "disabled_pending_provider_specific_review",
      automaticSignup: false
    },
    lifecycle: {
      expiry: "not_documented",
      usageSource: "official_billing_dashboard_and_api_error",
      freeCreditRefreshDays: 28,
      freeCreditExpiryDays: 28
    },
    freeUse: {
      program: "free_plan",
      initialCreditsUsd: 1,
      maxOpenModelParametersBillions: 7,
      openModelConcurrentRequests: 1,
      closedModelRequestsPerSecond: 10,
      requiresPerModelFreeConfirmation: true,
      paidUpgradeAllowed: false,
      autoReloadAllowed: false,
      autoScaleAllowed: false,
      paymentMethodAllowed: false
    }
  }
]);

const BY_ID = new Map(PROVIDER_CATALOG.map(provider => [provider.id, provider]));

export function getProviderDefinition(providerId) {
  const provider = BY_ID.get(providerId);
  return provider ?? null;
}

export function listProviderDefinitions() {
  return PROVIDER_CATALOG.map(provider => structuredClone(provider));
}

export function isKnownProvider(providerId) {
  return BY_ID.has(providerId);
}
