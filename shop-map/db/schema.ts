import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const store = sqliteTable('store', {
  id: integer('id').primaryKey(),
  document: text('document').notNull(),
  revision: integer('revision').notNull().default(0),
});
