// Security-rule tests. Run with `npm test` (needs Java 21+); GitHub Actions runs them on every push.
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

let env;
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const block = (uid, extra = {}) => ({ uid, type: 'free', start: '2026-12-10', end: '2026-12-12', note: '', created: '2026-11-26T00:00:00Z', ...extra });
const TYPE = { name: 'Free all day', color: '#00a05a', avail: 'yes', time: 'any', reach: 'yes', order: 1 };

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-planner', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins/boss'), { note: 'owner' });
    for (const [id, name, status] of [['boss', 'Boss', 'approved'], ['ann', 'Ann', 'approved'], ['ben', 'Ben', 'approved'], ['pat', 'Pat', 'pending'], ['dan', 'Dan', 'declined']])
      await setDoc(doc(db, `members/${id}`), { name, status, requested: '2026-11-26T00:00:00Z' });
    await setDoc(doc(db, 'emails/ann'), { email: 'ann@example.com' });
    await setDoc(doc(db, 'emails/pat'), { email: 'pat@example.com' });
    await setDoc(doc(db, 'types/free'), TYPE);
    await setDoc(doc(db, 'blocks/ann1'), block('ann', { start: '2026-12-01', end: '2026-12-07' }));
  });
});

// --- strangers and people still waiting ---
test('signed-out visitors can read nothing', async () => {
  await assertFails(getDocs(collection(anon(), 'blocks')));
  await assertFails(getDocs(collection(anon(), 'types')));
  await assertFails(getDoc(doc(anon(), 'members/ann')));
});
test('a new account can ask to join as itself, pending', async () => {
  const db = as('newbie');
  await assertSucceeds(setDoc(doc(db, 'members/newbie'), { name: 'Newbie', status: 'pending', requested: 'now' }));
  await assertSucceeds(setDoc(doc(db, 'emails/newbie'), { email: 'newbie@example.com' }));
  await assertSucceeds(getDoc(doc(db, 'members/newbie')));
});
test('a new account cannot approve itself, join as someone else, or fake its email', async () => {
  const db = as('newbie');
  await assertFails(setDoc(doc(db, 'members/newbie'), { name: 'Newbie', status: 'approved', requested: 'now' }));
  await assertFails(setDoc(doc(db, 'members/someoneelse'), { name: 'Sneaky', status: 'pending', requested: 'now' }));
  await assertFails(setDoc(doc(db, 'emails/newbie'), { email: 'boss@example.com' }));
});
test('pending people cannot see the planner or add blocks', async () => {
  const db = as('pat');
  await assertFails(getDocs(collection(db, 'blocks')));
  await assertFails(getDocs(collection(db, 'types')));
  await assertFails(setDoc(doc(db, 'blocks/p1'), block('pat')));
  await assertFails(getDocs(query(collection(db, 'members'), where('status', '==', 'approved'))));
});
test('pending people cannot approve themselves but can fix their name', async () => {
  const db = as('pat');
  await assertFails(updateDoc(doc(db, 'members/pat'), { status: 'approved' }));
  await assertFails(updateDoc(doc(db, 'members/pat'), { name: 'Pat', status: 'approved' }));
  await assertSucceeds(updateDoc(doc(db, 'members/pat'), { name: 'Patricia' }));
});
test('declined or removed people lose access', async () => {
  await assertFails(getDocs(collection(as('dan'), 'blocks')));
  await assertFails(setDoc(doc(as('dan'), 'blocks/d1'), block('dan')));
});

// --- team members ---
test('team members can read blocks, types and the approved team', async () => {
  const db = as('ben');
  await assertSucceeds(getDocs(collection(db, 'blocks')));
  await assertSucceeds(getDocs(collection(db, 'types')));
  await assertSucceeds(getDocs(query(collection(db, 'members'), where('status', '==', 'approved'))));
});
test('team members cannot list pending requests or read others\' emails', async () => {
  const db = as('ben');
  await assertFails(getDocs(collection(db, 'members')));
  await assertFails(getDoc(doc(db, 'emails/ann')));
  await assertFails(getDocs(collection(db, 'emails')));
});
test('team members can add, change and delete their own blocks', async () => {
  const db = as('ann');
  await assertSucceeds(setDoc(doc(db, 'blocks/ann2'), block('ann')));
  await assertSucceeds(updateDoc(doc(db, 'blocks/ann1'), { note: 'changed' }));
  await assertSucceeds(deleteDoc(doc(db, 'blocks/ann1')));
});
test('team members cannot touch anyone else\'s blocks', async () => {
  const db = as('ben');
  await assertFails(setDoc(doc(db, 'blocks/fake'), block('ann')));
  await assertFails(updateDoc(doc(db, 'blocks/ann1'), { note: 'hacked' }));
  await assertFails(setDoc(doc(db, 'blocks/ann1'), block('ben')));
  await assertFails(deleteDoc(doc(db, 'blocks/ann1')));
});
test('people cannot hand their block to someone else', async () => {
  await assertFails(updateDoc(doc(as('ann'), 'blocks/ann1'), { uid: 'ben' }));
});
test('blocks must be well formed', async () => {
  const db = as('ann');
  await assertFails(setDoc(doc(db, 'blocks/x1'), block('ann', { start: '2026-12-12', end: '2026-12-10' })));
  await assertFails(setDoc(doc(db, 'blocks/x2'), block('ann', { type: 'nope' })));
  await assertFails(setDoc(doc(db, 'blocks/x3'), block('ann', { extra: true })));
  await assertFails(setDoc(doc(db, 'blocks/x4'), block('ann', { note: 'x'.repeat(201) })));
  await assertFails(setDoc(doc(db, 'blocks/x5'), block('ann', { start: 'tomorrow' })));
});
test('team members cannot change types, approve people or make admins', async () => {
  const db = as('ben');
  await assertFails(setDoc(doc(db, 'types/new'), TYPE));
  await assertFails(updateDoc(doc(db, 'types/free'), { name: 'Renamed' }));
  await assertFails(deleteDoc(doc(db, 'types/free')));
  await assertFails(updateDoc(doc(db, 'members/pat'), { status: 'approved' }));
  await assertFails(updateDoc(doc(db, 'members/ann'), { name: 'Renamed by Ben' }));
  await assertFails(setDoc(doc(db, 'admins/ben'), { note: 'me' }));
});

// --- the admin ---
test('the admin can manage types, but only valid ones', async () => {
  const db = as('boss');
  await assertSucceeds(setDoc(doc(db, 'types/travel'), { ...TYPE, name: 'Travel', avail: 'no', time: 'none', reach: 'slow', order: 2 }));
  await assertSucceeds(updateDoc(doc(db, 'types/free'), { name: 'Free all day!' }));
  await assertSucceeds(deleteDoc(doc(db, 'types/travel')));
  await assertFails(setDoc(doc(db, 'types/bad'), { ...TYPE, avail: 'maybe' }));
  await assertFails(setDoc(doc(db, 'types/bad2'), { ...TYPE, color: 'red' }));
});
test('the admin can see requests and emails, approve, decline and forget', async () => {
  const db = as('boss');
  await assertSucceeds(getDocs(collection(db, 'members')));
  await assertSucceeds(getDocs(collection(db, 'emails')));
  await assertSucceeds(updateDoc(doc(db, 'members/pat'), { status: 'approved' }));
  await assertSucceeds(updateDoc(doc(db, 'members/ben'), { status: 'declined' }));
  await assertSucceeds(deleteDoc(doc(db, 'members/dan')));
  await assertFails(updateDoc(doc(db, 'members/ann'), { status: 'superuser' }));
});
test('once approved, a person can add their own blocks', async () => {
  await assertFails(setDoc(doc(as('pat'), 'blocks/p1'), block('pat')));
  await assertSucceeds(updateDoc(doc(as('boss'), 'members/pat'), { status: 'approved' }));
  await assertSucceeds(setDoc(doc(as('pat'), 'blocks/p1'), block('pat')));
});
test('the admin can remove anyone\'s block but not create or edit blocks for them', async () => {
  const db = as('boss');
  await assertFails(setDoc(doc(db, 'blocks/forann'), block('ann')));
  await assertFails(updateDoc(doc(db, 'blocks/ann1'), { note: 'admin edit' }));
  await assertSucceeds(deleteDoc(doc(db, 'blocks/ann1')));
});
test('nobody can make themselves an admin from the website', async () => {
  await assertFails(setDoc(doc(as('boss'), 'admins/ann'), { note: 'x' }));
  await assertFails(setDoc(doc(as('ann'), 'admins/ann'), { note: 'x' }));
  await assertFails(getDoc(doc(as('ann'), 'admins/boss')));
  await assertSucceeds(getDoc(doc(as('ann'), 'admins/ann')));
});
