'use strict';
const { Pool } = require('pg');

require('dotenv').config({ path: '.env.local' });
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log('--- Checking current policies on orders ---');
    const existing = await pool.query("SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'orders';");
    console.log('Existing:', existing.rows);

    console.log('--- Adding UPDATE policy ---');
    await pool.query('DROP POLICY IF EXISTS "Allow anon order update" ON public.orders;');
    await pool.query(`
        CREATE POLICY "Allow anon order update" 
        ON public.orders 
        FOR UPDATE 
        TO anon, authenticated 
        USING (true) 
        WITH CHECK (true);
    `);

    console.log('--- Adding DELETE policy ---');
    await pool.query('DROP POLICY IF EXISTS "Allow anon order delete" ON public.orders;');
    await pool.query(`
        CREATE POLICY "Allow anon order delete" 
        ON public.orders 
        FOR DELETE 
        TO anon, authenticated 
        USING (true);
    `);

    console.log('--- Granting UPDATE and DELETE privileges ---');
    await pool.query('GRANT UPDATE, DELETE ON public.orders TO anon, authenticated;');

    console.log('--- Verifying updated policies ---');
    const updated = await pool.query("SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'orders';");
    console.log('Updated Policies:', updated.rows);

    await pool.end();
    console.log('--- All policies applied successfully! ---');
}

run().catch(err => {
    console.error('Migration Error:', err);
    process.exit(1);
});
