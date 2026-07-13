import { createClient, Client } from '@libsql/client';

// Types
export type User = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
};

export type ItemType = 'receipt' | 'coupon' | 'warranty';

export type Item = {
  id: string;
  user_id: string;
  entity: string;
  type: ItemType;
  amount: number | null;
  deadline: string | null;
  estimated: boolean;
  offer: string | null;
  created_at: string;
  updated_at: string;
};

export type Reminder = {
  id: string;
  item_id: string;
  scheduled_for: string;
  status: 'pending' | 'sent' | 'cancelled';
  created_at: string;
};

// Database Initialization
export function initDB(url: string, authToken?: string): Client {
  const db = createClient({
    url,
    authToken,
  });
  return db;
}

export async function createSchema(db: Client) {
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('receipt', 'coupon', 'warranty')),
      amount REAL,
      deadline DATETIME,
      estimated BOOLEAN NOT NULL DEFAULT 0,
      offer TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);
    CREATE INDEX IF NOT EXISTS idx_items_deadline ON items(deadline);

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      scheduled_for DATETIME NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'cancelled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reminders_item_id ON reminders(item_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_status_scheduled ON reminders(status, scheduled_for);
  `;

  // split by ';' and execute
  const statements = schema.split(';').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) {
    await db.execute(statement);
  }
}

// User Operations
export async function createUser(db: Client, user: Omit<User, 'created_at'>): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO users (id, email, name) VALUES (?, ?, ?)',
    args: [user.id, user.email, user.name],
  });
}

export async function getUser(db: Client, id: string): Promise<User | null> {
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string | null,
    created_at: row.created_at as string,
  };
}

// Item Operations
export async function createItem(db: Client, item: Omit<Item, 'created_at' | 'updated_at'>): Promise<void> {
  await db.execute({
    sql: \`INSERT INTO items (id, user_id, entity, type, amount, deadline, estimated, offer) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)\`,
    args: [
      item.id,
      item.user_id,
      item.entity,
      item.type,
      item.amount,
      item.deadline,
      item.estimated ? 1 : 0,
      item.offer,
    ],
  });
}

export async function getItem(db: Client, id: string): Promise<Item | null> {
  const result = await db.execute({
    sql: 'SELECT * FROM items WHERE id = ?',
    args: [id],
  });
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    entity: row.entity as string,
    type: row.type as ItemType,
    amount: row.amount as number | null,
    deadline: row.deadline as string | null,
    estimated: Boolean(row.estimated),
    offer: row.offer as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export async function updateItem(db: Client, id: string, updates: Partial<Omit<Item, 'id' | 'user_id' | 'created_at' | 'updated_at'>>): Promise<void> {
  const setClauses = [];
  const args = [];
  
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(\`\${key} = ?\`);
      args.push(key === 'estimated' ? (value ? 1 : 0) : value);
    }
  }

  if (setClauses.length === 0) return;

  setClauses.push('updated_at = CURRENT_TIMESTAMP');
  args.push(id);

  await db.execute({
    sql: \`UPDATE items SET \${setClauses.join(', ')} WHERE id = ?\`,
    args,
  });
}

export async function deleteItem(db: Client, id: string): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM items WHERE id = ?',
    args: [id],
  });
}

// Loads the active urgency feed for a user, sorted by deadline (closest first)
export async function getUrgentItems(db: Client, user_id: string, limit: number = 20): Promise<Item[]> {
  const result = await db.execute({
    sql: \`SELECT * FROM items 
           WHERE user_id = ? 
             AND deadline IS NOT NULL 
             AND deadline >= date('now')
           ORDER BY deadline ASC 
           LIMIT ?\`,
    args: [user_id, limit],
  });
  
  return result.rows.map(row => ({
    id: row.id as string,
    user_id: row.user_id as string,
    entity: row.entity as string,
    type: row.type as ItemType,
    amount: row.amount as number | null,
    deadline: row.deadline as string | null,
    estimated: Boolean(row.estimated),
    offer: row.offer as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));
}

// Reminder Operations
export async function createReminder(db: Client, reminder: Omit<Reminder, 'created_at' | 'status'>): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO reminders (id, item_id, scheduled_for) VALUES (?, ?, ?)',
    args: [reminder.id, reminder.item_id, reminder.scheduled_for],
  });
}

export async function updateReminderStatus(db: Client, id: string, status: Reminder['status']): Promise<void> {
  await db.execute({
    sql: 'UPDATE reminders SET status = ? WHERE id = ?',
    args: [status, id],
  });
}

export async function getPendingReminders(db: Client, until: string): Promise<Reminder[]> {
  const result = await db.execute({
    sql: \`SELECT * FROM reminders 
           WHERE status = 'pending' 
             AND scheduled_for <= ?
           ORDER BY scheduled_for ASC\`,
    args: [until],
  });
  
  return result.rows.map(row => ({
    id: row.id as string,
    item_id: row.item_id as string,
    scheduled_for: row.scheduled_for as string,
    status: row.status as Reminder['status'],
    created_at: row.created_at as string,
  }));
}
