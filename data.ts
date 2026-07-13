import { createClient } from '@libsql/client/web';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { config } from './config';

export type ItemType = 'receipt' | 'coupon' | 'warranty';

export type Item = {
  id: number;
  entity: string;
  type: ItemType;
  amount: number;
  deadline: string; // YYYY-MM-DD
  estimated: boolean;
  offer?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
};

// Connect to Turso using standard Web API (fetch)
const db = createClient({
  url: config.turso.databaseUrl,
  authToken: config.turso.authToken,
});

let dbInitPromise: Promise<void> | null = null;
const initDb = () => {
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      try {
        await db.execute(`
          CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY,
            entity TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            deadline TEXT NOT NULL,
            estimated INTEGER NOT NULL,
            offer TEXT
          )
        `);
        await db.execute(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL
          )
        `);
      } catch (err) {
        console.error('DB Init Error', err);
      }
    })();
  }
  return dbInitPromise;
};

const USER_KEY = '@holdr_user_id';

export const DataStore = {
  async getItems(): Promise<Item[]> {
    try {
      await initDb();
      const res = await db.execute('SELECT * FROM items');
      return res.rows.map((row: any) => ({
        id: Number(row.id),
        entity: row.entity,
        type: row.type as ItemType,
        amount: Number(row.amount),
        deadline: row.deadline,
        estimated: Boolean(row.estimated),
        offer: row.offer || undefined,
      }));
    } catch (e) {
      console.error('Failed to load items from Turso', e);
      return [];
    }
  },

  async addItem(item: Omit<Item, 'id'>): Promise<Item> {
    await initDb();
    const id = Date.now();
    await db.execute({
      sql: 'INSERT INTO items (id, entity, type, amount, deadline, estimated, offer) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [id, item.entity, item.type, item.amount, item.deadline, item.estimated ? 1 : 0, item.offer || null],
    });
    return { ...item, id };
  },

  async updateItem(id: number, updates: Partial<Item>): Promise<void> {
    await initDb();
    const setClauses: string[] = [];
    const args: any[] = [];
    
    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      args.push(key === 'estimated' ? (value ? 1 : 0) : value);
    }
    
    if (setClauses.length === 0) return;
    
    args.push(id);
    await db.execute({
      sql: `UPDATE items SET ${setClauses.join(', ')} WHERE id = ?`,
      args,
    });
  },

  async deleteItem(id: number): Promise<void> {
    await initDb();
    await db.execute({
      sql: 'DELETE FROM items WHERE id = ?',
      args: [id],
    });
  },

  async getUser(): Promise<User | null> {
    try {
      await initDb();
      const userId = await AsyncStorage.getItem(USER_KEY);
      if (!userId) return null;
      
      const res = await db.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [userId],
      });
      
      if (res.rows.length === 0) return null;
      
      const row = res.rows[0];
      return { id: row.id as string, name: row.name as string, email: row.email as string };
    } catch (e) {
      console.error('Failed to load user', e);
      return null;
    }
  },

  async saveUser(user: User): Promise<void> {
    try {
      await initDb();
      await AsyncStorage.setItem(USER_KEY, user.id);
      
      await db.execute({
        sql: 'INSERT INTO users (id, name, email) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email',
        args: [user.id, user.name, user.email],
      });
    } catch (e) {
      console.error('Failed to save user', e);
    }
  },

  async removeUser(): Promise<void> {
    try {
      await AsyncStorage.removeItem(USER_KEY);
    } catch (e) {
      console.error('Failed to remove user', e);
    }
  },
};
