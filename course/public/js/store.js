/**
 * A reader's progress: which lessons are done and which steps are ticked.
 *
 * It always lives in this browser (localStorage). Signed in with Google, the same record is kept in
 * Firestore under `users/<uid>`, which only that user can read or write (firestore.rules), so the
 * progress follows the reader to another browser. The page works the same without an account, and
 * without Firebase at all (opened from a plain file server): then signing in is simply not offered.
 */
const KEY = 'hollin-course.progress';
const SDK = 'https://www.gstatic.com/firebasejs/12.4.0';

const empty = () => ({ done: {}, checks: {}, last: null, owner: null });

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') return { ...empty(), ...raw, done: { ...raw.done }, checks: { ...raw.checks } };
  } catch {
    // Unreadable or blocked storage: start empty; the page still works for this visit.
  }
  return empty();
}

let state = read();
const listeners = new Set();

/** What the page shows about the account: `available` is null until Firebase has answered. */
export const cloud = { available: null, user: null, syncing: false, error: null };

function emit() {
  for (const fn of listeners) fn();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Nothing to do: the progress then lasts as long as the tab.
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const isDone = (id) => Boolean(state.done[id]);
export const doneCount = (ids) => ids.filter(isDone).length;
export const checksOf = (id) => state.checks[id] ?? [];
export const lastLesson = () => state.last;

function changed() {
  persist();
  emit();
  scheduleUpload();
}

export function setDone(id, done) {
  if (done) state.done[id] = new Date().toISOString();
  else delete state.done[id];
  changed();
}

export function setCheck(id, index, on) {
  const set = new Set(checksOf(id));
  if (on) set.add(index);
  else set.delete(index);
  if (set.size) state.checks[id] = [...set].sort((a, b) => a - b);
  else delete state.checks[id];
  changed();
}

export function visit(id) {
  if (state.last === id) return;
  state.last = id;
  persist();
  scheduleUpload();
}

export function reset() {
  state = { ...empty(), owner: state.owner };
  changed();
}

/** Two records become one: a lesson done on either is done (the earlier date kept), a step ticked on either is ticked. */
function merge(local, remote) {
  const done = { ...remote.done };
  for (const [id, at] of Object.entries(local.done)) done[id] = done[id] && done[id] < at ? done[id] : at;
  const checks = {};
  for (const id of new Set([...Object.keys(local.checks), ...Object.keys(remote.checks ?? {})])) {
    checks[id] = [...new Set([...(local.checks[id] ?? []), ...(remote.checks?.[id] ?? [])])].sort((a, b) => a - b);
  }
  return { done, checks, last: local.last ?? remote.last ?? null };
}

// ---------- the account ----------

let fb = null;
let uploadTimer = null;

function scheduleUpload() {
  if (!fb || !cloud.user) return;
  clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => void upload(), 900);
}

async function upload() {
  if (!fb || !cloud.user) return;
  const { store, db } = fb;
  cloud.syncing = true;
  emit();
  try {
    await store.setDoc(store.doc(db, 'users', cloud.user.uid), { done: state.done, checks: state.checks, last: state.last, lang: document.documentElement.lang, updatedAt: store.serverTimestamp() });
    cloud.error = null;
  } catch (err) {
    cloud.error = err?.code || 'sync';
    console.warn('[course] the progress was not saved to the account', err);
  }
  cloud.syncing = false;
  emit();
}

async function adopt(user) {
  cloud.user = user ? { uid: user.uid, name: user.displayName || '', email: user.email || '', photo: user.photoURL || '' } : null;
  if (!user) {
    emit();
    return;
  }
  const { store, db } = fb;
  cloud.syncing = true;
  emit();
  try {
    const snap = await store.getDoc(store.doc(db, 'users', user.uid));
    const remote = snap.exists() ? snap.data() : { done: {}, checks: {}, last: null };
    // Progress made before signing in joins the account's; another account's progress left in this browser does not.
    const mine = state.owner === null || state.owner === user.uid;
    const next = mine ? merge(state, remote) : merge(empty(), remote);
    state = { ...next, owner: user.uid };
    persist();
    cloud.error = null;
    await upload();
  } catch (err) {
    cloud.error = err?.code || 'sync';
    cloud.syncing = false;
    console.warn('[course] the account progress could not be read', err);
  }
  emit();
}

/**
 * Starts Firebase when the page is served by Firebase Hosting (which answers `/__/firebase/init.json`
 * with the project's web configuration, so none is written in the source). Elsewhere it does nothing.
 */
export async function initCloud() {
  try {
    const response = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!response.ok || !(response.headers.get('content-type') || '').includes('json')) throw new Error('no Firebase configuration here');
    const config = await response.json();
    const [app, auth, store] = await Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore-lite.js`)]);
    const instance = app.initializeApp(config);
    fb = { auth, store, authInstance: auth.getAuth(instance), db: store.getFirestore(instance) };
    cloud.available = true;
    auth.onAuthStateChanged(fb.authInstance, (user) => void adopt(user));
  } catch (err) {
    cloud.available = false;
    console.info('[course] no account sign-in here; progress stays in this browser.', err?.message ?? err);
  }
  emit();
}

/** Opens Google's sign-in window. Resolves to null when it worked, else to an error code the page words. */
export async function signIn() {
  if (!fb) return 'unavailable';
  const { auth, authInstance } = fb;
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await auth.signInWithPopup(authInstance, provider);
    return null;
  } catch (err) {
    const code = err?.code || 'unknown';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' || code === 'auth/user-cancelled') return 'cancelled';
    console.warn('[course] sign-in failed', err);
    return code === 'auth/popup-blocked' ? 'blocked' : code;
  }
}

export async function signOut() {
  if (!fb) return;
  clearTimeout(uploadTimer);
  await upload();
  await fb.auth.signOut(fb.authInstance);
}
