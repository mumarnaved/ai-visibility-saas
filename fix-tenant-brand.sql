UPDATE platform.tenants
SET
  name = 'SoftwareDome',
  slug = 'softwaredome',
  updated_at = NOW()
WHERE id = 'c32e1840-fb74-4b3d-bf56-f7a97af32a8e';

SELECT
  id,
  slug,
  name,
  website_url,
  schema_name,
  status,
  plan,
  updated_at
FROM platform.tenants
WHERE id = 'c32e1840-fb74-4b3d-bf56-f7a97af32a8e';