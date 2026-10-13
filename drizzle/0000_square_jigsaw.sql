CREATE TABLE "comites" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"candidato" jsonb,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversas" (
	"id" serial PRIMARY KEY NOT NULL,
	"comite_id" integer NOT NULL,
	"usuario_id" integer NOT NULL,
	"titulo" text DEFAULT 'Conversa' NOT NULL,
	"mensagens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "convites" (
	"codigo" text PRIMARY KEY NOT NULL,
	"comite_id" integer NOT NULL,
	"papel" text DEFAULT 'cabo' NOT NULL,
	"coordenador_id" integer,
	"criado_por" integer NOT NULL,
	"usos" integer DEFAULT 0 NOT NULL,
	"max_usos" integer DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ia_usos" (
	"usuario_id" integer NOT NULL,
	"dia" text NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ia_usos_usuario_id_dia_pk" PRIMARY KEY("usuario_id","dia")
);
--> statement-breakpoint
CREATE TABLE "notas" (
	"id" serial PRIMARY KEY NOT NULL,
	"comite_id" integer NOT NULL,
	"usuario_id" integer,
	"texto" text NOT NULL,
	"lugar" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"busca" "tsvector" GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(lugar, '') || ' ' || texto)) STORED
);
--> statement-breakpoint
CREATE TABLE "relatorios" (
	"id" serial PRIMARY KEY NOT NULL,
	"comite_id" integer NOT NULL,
	"usuario_id" integer,
	"titulo" text NOT NULL,
	"conteudo" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"usuario_id" integer NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "territorios" (
	"usuario_id" integer PRIMARY KEY NOT NULL,
	"nome" text DEFAULT 'Meu território' NOT NULL,
	"itens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meta" integer DEFAULT 0 NOT NULL,
	"ref" jsonb,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"comite_id" integer NOT NULL,
	"nome" text NOT NULL,
	"usuario" text NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" text DEFAULT 'cabo' NOT NULL,
	"coordenador_id" integer,
	"telefone" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convites" ADD CONSTRAINT "convites_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ia_usos" ADD CONSTRAINT "ia_usos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas" ADD CONSTRAINT "notas_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas" ADD CONSTRAINT "notas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorios" ADD CONSTRAINT "relatorios_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relatorios" ADD CONSTRAINT "relatorios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territorios" ADD CONSTRAINT "territorios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_comite_id_comites_id_fk" FOREIGN KEY ("comite_id") REFERENCES "public"."comites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversas_usuario_idx" ON "conversas" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "convites_comite_idx" ON "convites" USING btree ("comite_id");--> statement-breakpoint
CREATE INDEX "notas_comite_idx" ON "notas" USING btree ("comite_id");--> statement-breakpoint
CREATE INDEX "notas_busca_idx" ON "notas" USING gin ("busca");--> statement-breakpoint
CREATE INDEX "relatorios_comite_idx" ON "relatorios" USING btree ("comite_id");--> statement-breakpoint
CREATE INDEX "sessoes_usuario_idx" ON "sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_usuario_idx" ON "usuarios" USING btree ("usuario");--> statement-breakpoint
CREATE INDEX "usuarios_comite_idx" ON "usuarios" USING btree ("comite_id");