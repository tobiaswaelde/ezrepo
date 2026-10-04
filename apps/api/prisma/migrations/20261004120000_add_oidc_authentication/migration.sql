CREATE TYPE "AuthProvider" AS ENUM ('LOCAL', 'OIDC');

ALTER TABLE "users"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "authProvider" "AuthProvider" NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "oidcIssuer" VARCHAR(2048),
  ADD COLUMN "oidcSubject" VARCHAR(512);

CREATE UNIQUE INDEX "users_oidcIssuer_oidcSubject_key" ON "users"("oidcIssuer", "oidcSubject");

ALTER TABLE "users"
  ADD CONSTRAINT "users_auth_identity_check" CHECK (
    ("authProvider" = 'LOCAL' AND "passwordHash" IS NOT NULL AND "oidcIssuer" IS NULL AND "oidcSubject" IS NULL)
    OR
    ("authProvider" = 'OIDC' AND "passwordHash" IS NULL AND "oidcIssuer" IS NOT NULL AND "oidcSubject" IS NOT NULL)
  );

CREATE TABLE "oidc_configs" (
  "id" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "key" VARCHAR(64) NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "providerName" VARCHAR(64),
  "issuer" VARCHAR(2048),
  "clientId" VARCHAR(512),
  "encryptedClientSecret" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
  "groupsClaim" VARCHAR(200) NOT NULL DEFAULT 'groups',
  "systemAdministratorGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "managerGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "viewerGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowUnmatchedViewer" BOOLEAN NOT NULL DEFAULT false,
  "allowHttpIssuer" BOOLEAN NOT NULL DEFAULT false,
  "observedGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "configRevision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "oidc_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "oidc_configs_singleton_check" CHECK ("key" = 'global')
);

CREATE UNIQUE INDEX "oidc_configs_key_key" ON "oidc_configs"("key");

CREATE TABLE "oidc_login_transactions" (
  "id" UUID NOT NULL,
  "stateHash" VARCHAR(64) NOT NULL,
  "nonce" VARCHAR(512) NOT NULL,
  "codeVerifier" VARCHAR(512) NOT NULL,
  "bindingHash" VARCHAR(64) NOT NULL,
  "configRevision" INTEGER NOT NULL,
  "returnTo" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "oidc_login_transactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oidc_login_transactions_stateHash_key" ON "oidc_login_transactions"("stateHash");
CREATE INDEX "oidc_login_transactions_bindingHash_idx" ON "oidc_login_transactions"("bindingHash");
CREATE INDEX "oidc_login_transactions_expiresAt_idx" ON "oidc_login_transactions"("expiresAt");

CREATE TABLE "oidc_session_exchanges" (
  "id" UUID NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "returnTo" VARCHAR(512) NOT NULL DEFAULT '/',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "oidc_session_exchanges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oidc_session_exchanges_codeHash_key" ON "oidc_session_exchanges"("codeHash");
CREATE INDEX "oidc_session_exchanges_expiresAt_idx" ON "oidc_session_exchanges"("expiresAt");

ALTER TABLE "oidc_session_exchanges"
  ADD CONSTRAINT "oidc_session_exchanges_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
