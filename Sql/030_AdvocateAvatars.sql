-- 030_AdvocateAvatars.sql
-- Sets unique illustrated portrait avatars for advocates who have no avatar_url.
-- Uses DiceBear 9.x lorelei style seeded by advocate name — deterministic and free.
-- Preserves existing avatars (e.g. Cloudinary uploads) via IS NULL guard.

UPDATE users u
SET avatar_url =
  'https://api.dicebear.com/9.x/lorelei/png?seed='
  || replace(replace(replace(a.name, ' ', '%20'), '.', ''), ',', '')
  || '&size=200&backgroundType=solid&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf'
FROM advocates a
WHERE a.user_id = u.id
  AND u.avatar_url IS NULL
  AND a.name != ''
  AND a.name IS NOT NULL;

-- Report what was updated
SELECT a.name, u.avatar_url
FROM advocates a
JOIN users u ON u.id = a.user_id
WHERE u.avatar_url LIKE '%dicebear%'
ORDER BY a.name;
