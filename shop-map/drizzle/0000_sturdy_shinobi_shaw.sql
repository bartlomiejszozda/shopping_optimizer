CREATE TABLE `store` (
	`id` integer PRIMARY KEY NOT NULL,
	`document` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
