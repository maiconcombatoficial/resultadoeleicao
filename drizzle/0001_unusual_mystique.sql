CREATE TABLE "codigos_login" (
	"codigo_hash" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ia_usos_comite" (
	"comite_id" integer NOT NULL,
	"dia" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ia_usos_comite_comite_id_dia_pk" PRIMARY KEY("comite_id","dia")
);
--> statement-breakpoint
CREATE TABLE "limites" (
	"chave" text PRIMARY KEY NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	"janela_ate" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_estados" (
	"estado" text PRIMARY KEY NOT NULL,
	"convite" text,
	"vis" text,
	"aceite" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" serial PRIMARY KEY NOT NULL,
	"comite_id" integer NOT NULL,
	"plano" text NOT NULL,
	"periodo" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"tipo" text NOT NULL,
	"mp_id" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"raw" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recuperacoes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usada_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "senha_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comites" ADD COLUMN "plano" text DEFAULT 'gratis' NOT NULL;--> statement-breakpoint
ALTER TABLE "comites" ADD COLUMN "periodo" text;--> statement-breakpoint
ALTER TABLE "comites" ADD COLUMN "plano_ate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comites" ADD COLUMN "mp_preapproval_id" text;--> statement-breakpoint
ALTER TABLE "comites" ADD COLUMN "mp_ultimo_pagamento_id" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "google_id" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "aceite_termos_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "codigos_login" ADD CONSTRAINT "codigos_login_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_usos_comite" ADD CONSTRAINT "ia_usos_comite_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recuperacoes" ADD CONSTRAINT "recuperacoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_mp_idx" ON "pagamentos" USING btree ("mp_id");--> statement-breakpoint
CREATE INDEX "pagamentos_comite_idx" ON "pagamentos" USING btree ("comite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_idx" ON "usuarios" USING btree ("email") WHERE "usuarios"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_google_idx" ON "usuarios" USING btree ("google_id") WHERE "usuarios"."google_id" is not null;