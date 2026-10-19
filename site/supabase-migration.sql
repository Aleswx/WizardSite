-- Execute este SQL no painel do Supabase (SQL Editor)
-- para adicionar as novas colunas na tabela leads

ALTER TABLE leads ADD COLUMN IF NOT EXISTS guardian_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS guardian_phone TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_consent TEXT;

-- Verificar se as colunas foram adicionadas
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'leads'
ORDER BY ordinal_position;
