// Firebase Auth（Google ログイン）の薄いラッパー。SDK は gstatic の CDN から読む（ビルド不要）。
const CDN = 'https://www.gstatic.com/firebasejs/13.3.0';
let fa;
let auth;

export async function initAuth({ apiKey, projectId }) {
  const [{ initializeApp }, m] = await Promise.all([import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`)]);
  fa = m;
  auth = fa.getAuth(initializeApp({ apiKey, projectId, authDomain: `${projectId}.firebaseapp.com` }));
}

// ポップアップが基本。ブロックされたときだけリダイレクト
export async function signIn() {
  const p = new fa.GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  try {
    await fa.signInWithPopup(auth, p);
  } catch (e) {
    if (e.code === 'auth/popup-blocked') return fa.signInWithRedirect(auth, p);
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') throw e;
  }
}

export const signOut = () => fa.signOut(auth);
export const onChange = (cb) => fa.onAuthStateChanged(auth, cb);
export const getIdToken = () => auth.currentUser.getIdToken();
