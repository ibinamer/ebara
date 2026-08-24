CREATE TABLE `google_translation_usage` (
  `month_key` text PRIMARY KEY NOT NULL,
  `characters_used` integer DEFAULT 0 NOT NULL CHECK (
    `characters_used` >= 0 AND `characters_used` <= 450000
  ),
  `warning_emitted` integer DEFAULT 0 NOT NULL CHECK (
    `warning_emitted` IN (0, 1)
  ),
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
