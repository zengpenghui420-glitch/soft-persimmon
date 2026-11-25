// Mocked order-unlock checks. Synthetic ids only. Chrome is pinned to 127.0.0.1
// for the API and Mantle hosts, so a missed mock cannot redeem a real order or code.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire('/tmp/ppt/package.json');
const puppeteer = require('puppeteer-core');

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const API_HOST = 'snappy-tundra-7uesdvk-zengpenghui420-glitch.vercel.app';
const API = 'https://' + API_HOST;
const ORDER = 'P847291038475610293';
const CODE = 'SPABCD';
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}/`;
const ART = '/opt/cursor/artifacts';

function patternError(id) {
  if (!/^P\d{18}$/.test(id)) return 'shape';
  const d = id.slice(1);
  for (const size of [1, 2, 3, 6, 9]) {
    if (d.slice(0, size).repeat(d.length / size) === d) return 'repeat';
  }
  const step = (d.charCodeAt(1) - d.charCodeAt(0) + 10) % 10;
  if (step === 1 || step === 9) {
    let seq = true;
    for (let i = 1; i < d.length; i++) {
      if ((d.charCodeAt(i) - d.charCodeAt(i - 1) + 10) % 10 !== step) seq = false;
    }
    if (seq) return 'sequence';
  }
  return '';
}
if (patternError(ORDER)) throw new Error('synthetic order is not a legal id: ' + patternError(ORDER));
if (!/^SP[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(CODE)) throw new Error('synthetic code shape');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Content-Type,Authorization,X-Device-Id,X-Fingerprint,X-Mantle-Key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'content-type': 'application/json',
};

function freshState() {
  return {
    uses: 0,
    max: 3,
    bound: false,
    cross: false,
    redeemMode: 'ok',
    vaultMode: 'ok',
    vaultGet: 'ok',
    mantleRemaining: 3,
    mantleMissing: false,
    posts: 0,
    peeks: 0,
    vaultPosts: 0,
    vaultGets: 0,
    mantleGets: 0,
    mantleDecr: 0,
    mantleIncr: 0,
    bodies: [],
    urls: [],
    unexpected: [],
  };
}

async function send(req, status, obj) {
  await req.respond({ status, headers: CORS, body: JSON.stringify(obj) });
}

function orderBody(state, orderId) {
  return {
    ok: true,
    remaining: state.max - state.uses,
    max: state.max,
    uses: state.uses,
    quiz: 'soft',
    orderId,
    bound: true,
    paidVerified: false,
  };
}

async function handleApi(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  const quiz = u.searchParams.get('quiz');
  state.urls.push(req.method() + ' ' + u.pathname + u.search);
  if (u.pathname === '/order/get') {
    state.peeks++;
    if (quiz !== 'soft') return send(req, 400, { ok: false, error: 'invalid' });
    if (state.cross) return send(req, 403, { ok: false, error: 'bound_other_quiz' });
    if (!state.bound) return send(req, 404, { ok: false, error: 'not_found' });
    return send(req, 200, orderBody(state, u.searchParams.get('orderId')));
  }
  if (u.pathname === '/order/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.posts++;
    if (state.redeemMode === 'timeout-commit' || state.redeemMode === 'timeout-drop') {
      if (state.redeemMode === 'timeout-commit') {
        state.uses += 1;
        state.bound = true;
      }
      const snapshot = orderBody(state, body.orderId);
      setTimeout(() => {
        send(req, 200, snapshot).catch(() => {});
      }, 1500);
      return;
    }
    if (body.quiz !== 'soft' || body.orderId !== ORDER) return send(req, 400, { ok: false, error: 'invalid' });
    if (state.cross) return send(req, 403, { ok: false, error: 'bound_other_quiz' });
    if (state.uses >= state.max) return send(req, 403, { ok: false, error: 'exhausted', remaining: 0, max: 3 });
    state.uses += 1;
    state.bound = true;
    return send(req, 200, orderBody(state, body.orderId));
  }
  if (u.pathname === '/redeem' && req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    state.vaultPosts++;
    if (state.vaultMode === 'down') {
      await req.abort('failed');
      return;
    }
    if (state.vaultMode === 'not_found') return send(req, 404, { ok: false, error: 'not_found' });
    if (state.vaultMode === 'exhausted') return send(req, 403, { ok: false, error: 'exhausted' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  if (u.pathname === '/get') {
    state.vaultGets++;
    if (quiz !== 'soft') return send(req, 400, { ok: false, error: 'invalid' });
    if (state.vaultGet === 'miss') return send(req, 404, { ok: false, error: 'not_found' });
    return send(req, 200, { ok: true, remaining: 2, max: 3 });
  }
  state.unexpected.push('api ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function handleMantle(req, u, state) {
  if (req.method() === 'OPTIONS') {
    await req.respond({ status: 204, headers: CORS, body: '' });
    return;
  }
  state.urls.push(req.method() + ' mantle ' + u.pathname);
  if (!u.pathname.includes('/sp/')) {
    state.unexpected.push('mantle-col ' + u.pathname);
    await req.abort('failed');
    return;
  }
  if (req.method() === 'GET') {
    state.mantleGets++;
    if (state.mantleMissing) return send(req, 404, { error: 'not_found' });
    return send(req, 200, { remaining: state.mantleRemaining, max: 3 });
  }
  if (req.method() === 'POST' && u.pathname.includes('/increment/')) {
    const body = JSON.parse(req.postData() || '{}');
    state.bodies.push(body);
    if (body.by === -1) {
      state.mantleDecr++;
      if (state.mantleDecrResult != null) return send(req, 200, { remaining: state.mantleDecrResult });
      state.mantleRemaining -= 1;
    } else if (body.by === 1) {
      state.mantleIncr++;
      state.mantleRemaining += 1;
    } else {
      state.unexpected.push('mantle by ' + body.by);
    }
    return send(req, 200, { remaining: state.mantleRemaining });
  }
  state.unexpected.push('mantle ' + req.method() + ' ' + u.pathname);
  await req.abort('failed');
}

async function arm(page, state, opts = {}) {
  if (opts.timeoutMs) {
    await page.evaluateOnNewDocument((ms) => {
      globalThis.__ORDER_TIMEOUT_MS = ms;
      globalThis.__ORDER_RECONCILE_MS = 0;
    }, opts.timeoutMs);
  }
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
        await req.continue();
        return;
      }
      if (u.hostname === API_HOST) return await handleApi(req, u, state);
      if (u.hostname === 'mantledb.sh') return await handleMantle(req, u, state);
      state.unexpected.push(u.hostname + req.url());
      await req.abort('failed');
    } catch (e) {
      state.unexpected.push('handler ' + e.message);
      try { await req.abort('failed'); } catch (err) {}
    }
  });
}

function assert(cond, msg, state) {
  if (!cond) {
    const extra = state ? '\n' + JSON.stringify({
      uses: state.uses, posts: state.posts, peeks: state.peeks,
      vaultPosts: state.vaultPosts, vaultGets: state.vaultGets,
      mantleGets: state.mantleGets, mantleDecr: state.mantleDecr, mantleIncr: state.mantleIncr,
      bodies: state.bodies, urls: state.urls, unexpected: state.unexpected,
    }, null, 2) : '';
    throw new Error(msg + extra);
  }
}

async function openAndSubmit(page, value) {
  await page.click('#btnStart');
  await page.waitForSelector('#codeMask.show');
  await page.$eval('#codeInput', (el, v) => { el.value = v; }, value);
  await page.click('#btnCodeOk');
}

async function waitQuiz(page) {
  await page.waitForFunction(() => document.getElementById('quiz').classList.contains('active'), { timeout: 8000 });
}

async function waitResult(page) {
  await page.waitForFunction(() => document.getElementById('result').classList.contains('active'), { timeout: 8000 });
}

async function fastFinish(page) {
  await page.evaluate(() => {
    ans = Array(QS.length).fill(3);
    qi = QS.length - 1;
    finish();
  });
  await waitResult(page);
}

async function answerOne(page) {
  const before = await page.$eval('#qno', (el) => el.textContent);
  await page.click('#opts .opt');
  await page.waitForFunction((prev) => document.getElementById('qno').textContent !== prev, { timeout: 3000 }, before);
}

async function overflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    let max = 0;
    let min = 0;
    let offender = '';
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.right > max) {
        max = r.right;
        offender = (el.id || el.className || el.tagName).toString().slice(0, 80);
      }
      if (r.left < min) min = r.left;
    }
    const input = document.getElementById('codeInput');
    const inputFit = !input || input.getClientRects().length === 0
      ? null
      : input.scrollWidth <= input.clientWidth + 2;
    return { vw, max: Math.round(max), min: Math.round(min), offender, inputFit, overflow: max > vw + 1 || min < -1 };
  });
}

async function shot(page, name) {
  await mkdir(ART, { recursive: true });
  await page.screenshot({ path: join(ART, name), fullPage: false });
}

async function newPage(browser, state, opts = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.setCacheEnabled(false);
  await page.setViewport(opts.viewport || { width: 390, height: 844, isMobile: true, hasTouch: true });
  await arm(page, state, opts);
  await page.goto(BASE + (opts.path || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof redeemOrder === 'function' && typeof redeemAccess === 'function');
  return { page, errors };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('format helpers reject patterns and keep SP codes off the order path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const out = await page.evaluate((order) => ({
    good: orderFormatError(order),
    repeat: orderFormatError('P111111111111111111'),
    seq: orderFormatError('P123456789012345678'),
    pasted: classifyInput(' 「p8472-9103-8475-610293」 '),
    code: classifyInput(' sp ab cd '),
    junk: classifyInput('hello'),
    badCode: classifyInput('SPIIII'),
    shortP: classifyInput('P12345'),
    accept: decideTimeout(0, { ok: true, uses: 1 }),
    retrySame: decideTimeout(1, { ok: true, uses: 1 }),
    retryMiss: decideTimeout(0, { ok: false, error: 'not_found' }),
    acceptBound: decideTimeout(null, { ok: true, uses: 2 }),
    noDouble: decideTimeout(1, { ok: true, uses: 2 }),
    other: decideTimeout(0, { ok: false, error: 'bound_other_quiz' }),
    quiz: QUIZ_KEY,
    api: API_BASE,
  }), ORDER);
  assert(out.good === '', 'legal synthetic id rejected ' + out.good);
  assert(out.repeat === 'invalid' && out.seq === 'invalid', 'pattern ids should be invalid');
  assert(out.pasted.type === 'order' && out.pasted.orderId === ORDER, 'paste normalize ' + JSON.stringify(out.pasted));
  assert(out.code.type === 'code' && out.code.code === CODE, 'spaced SP code ' + JSON.stringify(out.code));
  assert(out.junk.type === 'other' && out.badCode.type === 'other' && out.shortP.type === 'order-invalid', 'classifier mixed');
  assert(out.accept === 'accept' && out.noDouble === 'accept', 'timeout should accept a consumed use');
  assert(out.retrySame === 'retry' && out.retryMiss === 'retry', 'timeout should retry only when uses did not move');
  assert(out.acceptBound === 'accept', 'unknown before-count must not redeem again once bound');
  assert(out.other === 'return', 'cross-quiz peek is not a retry');
  assert(out.quiz === 'soft' && out.api === API, 'quiz/api constants');
  assert(state.posts === 0 && state.vaultPosts === 0 && state.unexpected.length === 0, 'format checks must not hit the network', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('first redeem, refresh, continue', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  const visible = await page.evaluate(() => document.body.innerText);
  assert(!visible.includes('验证码') && !visible.includes('已付款') && !visible.includes('paidVerified'), 'start copy');
  assert(visible.includes('你有多容易被人欺负测试'), 'product title');
  await openAndSubmit(page, ' 「p8472-9103-8475-610293」 ');
  await waitQuiz(page);
  assert(state.posts === 1 && state.uses === 1 && state.peeks === 1, 'first redeem counts', state);
  assert(state.bodies[0].quiz === 'soft' && state.bodies[0].orderId === ORDER && !('code' in state.bodies[0]), 'redeem body', state);
  assert(state.vaultPosts === 0 && state.mantleGets === 0, 'order path must not touch legacy', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('还可以测 2 次') && !toast.includes('付款'), 'success copy ' + toast);
  const q1 = await page.$eval('#qtext', (el) => el.textContent);
  assert(q1.startsWith('明明已经很累'), 'first question changed: ' + q1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  assert(state.posts === 1 && state.uses === 1, 'refresh at question 1 must not redeem again', state);
  await answerOne(page);
  await answerOne(page);
  const prog = await page.$eval('#qprog', (el) => el.textContent);
  assert(prog === '3 / 18', 'progress ' + prog);
  const postsAtQ3 = state.posts;
  const peeksAtQ3 = state.peeks;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitQuiz(page);
  const resumed = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    qi,
    a0: ans[0],
    a1: ans[1],
  }));
  assert(resumed.prog === '3 / 18' && resumed.qi === 2 && resumed.a0 === 1 && resumed.a1 === 1, 'mid refresh ' + JSON.stringify(resumed));
  assert(state.posts === postsAtQ3 && state.peeks === peeksAtQ3, 'mid refresh must not peek or redeem', state);
  await page.click('#qback');
  await page.click('#qback');
  await page.click('#qback');
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  await page.click('#btnStart');
  await waitQuiz(page);
  const cont = await page.evaluate(() => ({
    prog: document.getElementById('qprog').textContent,
    sel: document.querySelectorAll('#opts .opt.sel').length,
    a0: ans[0],
  }));
  assert(cont.prog === '1 / 18' && cont.sel === 1 && cont.a0 === 1, 'continue reset the attempt ' + JSON.stringify(cont));
  assert(state.posts === postsAtQ3, 'continue must not redeem', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('result peek, retest, fourth reject keeps the result', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  const firstIndex = await page.$eval('.index-num', (el) => el.textContent);
  const posts = state.posts;
  const peeks = state.peeks;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitResult(page);
  const peeked = await page.$eval('.index-num', (el) => el.textContent);
  assert(peeked === firstIndex, 'result refresh changed the index');
  assert(state.posts === posts && state.peeks === peeks + 1, 'result refresh must peek once and not redeem', state);
  assert(state.urls.some((u) => u.startsWith('GET /order/get?quiz=soft&orderId=' + ORDER)), 'peek url', state);

  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(state.posts === 2 && state.uses === 2, 'retest should consume the second use', state);
  const restarted = await page.evaluate(() => ({ prog: document.getElementById('qprog').textContent, len: ans.length }));
  assert(restarted.prog === '1 / 18' && restarted.len === 0, 'retest should open a new attempt ' + JSON.stringify(restarted));
  await fastFinish(page);
  await page.click('#btnRetry');
  await waitQuiz(page);
  assert(state.uses === 3 && state.posts === 3, 'third use', state);
  await fastFinish(page);
  const kept = await page.$eval('.index-num', (el) => el.textContent);
  const title = await page.$eval('#typeTitle', (el) => el.textContent);
  const postsBefore = state.posts;
  await page.click('#btnRetry');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('3 次已经用完'));
  const after = await page.evaluate(() => ({
    result: document.getElementById('result').classList.contains('active'),
    index: document.querySelector('.index-num').textContent,
    title: document.getElementById('typeTitle').textContent,
    phase: sessionPhase(),
  }));
  assert(after.result && after.index === kept && after.title === title, 'fourth try dropped the result ' + JSON.stringify(after));
  assert(state.posts === postsBefore && state.uses === 3, 'fourth try must not redeem again', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('cross-quiz stops before redeem', async (browser) => {
  const state = freshState();
  state.cross = true;
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('别的测试'));
  const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  const unlocked = await page.evaluate(() => isUnlocked());
  assert(!onQuiz && !unlocked, 'cross-quiz unlocked the quiz');
  assert(state.posts === 0 && state.peeks === 1, 'cross-quiz must not redeem', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('timed-out redeem that already consumed does not post again', async (browser) => {
  const state = freshState();
  state.redeemMode = 'timeout-commit';
  const { page, errors } = await newPage(browser, state, { timeoutMs: 200 });
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  assert(state.posts === 1 && state.uses === 1, 'timeout commit posted more than once', state);
  assert(state.peeks >= 2, 'timeout should reconcile with peek', state);
  await page.close();
  assert(errors.length === 0, errors.join('\n'));
});

test('timed-out redeem that did not consume retries once then stops', async (browser) => {
  const state = freshState();
  state.redeemMode = 'timeout-drop';
  const { page, errors } = await newPage(browser, state, { timeoutMs: 200 });
  await openAndSubmit(page, ORDER);
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('暂时验证不了'), { timeout: 5000 });
  const onQuiz = await page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && !await page.evaluate(() => isUnlocked()), 'dropped timeout must not unlock');
  assert(state.posts === 2 && state.uses === 0, 'should retry exactly once', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('invalid and unknown input never call the network', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'P123456789012345678');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  await page.$eval('#codeInput', (el) => { el.value = 'hello'; });
  await page.click('#btnCodeOk');
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('格式不对'));
  assert(state.posts === 0 && state.peeks === 0 && state.vaultPosts === 0 && state.mantleGets === 0, 'invalid input reached the network', state);
  assert(state.unexpected.length === 0, 'unexpected', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('legacy vault hit does not fall through to Mantle', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await openAndSubmit(page, 'sp ab cd');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.bodies[0].quiz === 'soft' && state.bodies[0].code === CODE, 'vault body', state);
  assert(!state.bodies[0].orderId, 'legacy redeem must not send orderId', state);
  assert(state.posts === 0 && state.peeks === 0, 'legacy must not call /order', state);
  assert(state.mantleGets === 0 && state.mantleDecr === 0, 'vault hit must not touch Mantle', state);
  assert(state.urls.some((u) => u.startsWith('POST /redeem')), 'vault url', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('legacy vault miss falls back to Mantle, exhausted vault does not', async (browser) => {
  const miss = freshState();
  miss.vaultMode = 'not_found';
  const opened = await newPage(browser, miss);
  await openAndSubmit(opened.page, CODE);
  await waitQuiz(opened.page);
  assert(miss.vaultPosts === 1 && miss.mantleGets === 1 && miss.mantleDecr === 1 && miss.mantleIncr === 0, 'mantle fallback', miss);
  assert(miss.mantleRemaining === 2, 'remaining after decr', miss);
  assert(miss.urls.some((u) => u.includes('/sp/' + CODE)), 'mantle collection', miss);
  await opened.page.close();

  const done = freshState();
  done.vaultMode = 'exhausted';
  const second = await newPage(browser, done);
  await openAndSubmit(second.page, CODE);
  await second.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完'));
  const onQuiz = await second.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && done.mantleGets === 0 && done.mantleDecr === 0, 'exhausted vault fell through', done);
  await second.page.close();
});

test('legacy vault outage falls back to Mantle and rolls a negative decrement back', async (browser) => {
  const down = freshState();
  down.vaultMode = 'down';
  const opened = await newPage(browser, down);
  await openAndSubmit(opened.page, CODE);
  await waitQuiz(opened.page);
  assert(down.vaultPosts === 1 && down.mantleDecr === 1 && down.mantleRemaining === 2, 'outage fallback', down);
  await opened.page.close();

  const rollback = freshState();
  rollback.vaultMode = 'not_found';
  rollback.mantleRemaining = 1;
  rollback.mantleDecrResult = -1;
  const page2 = await newPage(browser, rollback);
  await openAndSubmit(page2.page, CODE);
  await page2.page.waitForFunction(() => document.getElementById('toast').textContent.includes('次数已经用完'));
  const onQuiz = await page2.page.$eval('#quiz', (el) => el.classList.contains('active'));
  assert(!onQuiz && rollback.mantleDecr === 1 && rollback.mantleIncr === 1, 'rollback', rollback);
  await page2.page.close();

  const both = freshState();
  both.vaultMode = 'down';
  both.mantleMissing = true;
  const page3 = await newPage(browser, both);
  await openAndSubmit(page3.page, CODE);
  await page3.page.waitForFunction(() => document.getElementById('toast').textContent.includes('网络异常'));
  assert(await page3.page.evaluate(() => !isUnlocked()), 'network failure unlocked');
  await page3.page.close();
});

test('legacy peek and same-tab code retry keep the original path', async (browser) => {
  const state = freshState();
  const { page, errors } = await newPage(browser, state);
  await page.evaluate((code) => {
    localStorage.setItem(LAST_KEY, JSON.stringify({ R: 40, B: 50, C: 60, index: 50, at: Date.now() }));
    setUnlocked(code);
    refreshLastBtn();
  }, CODE);
  await page.click('#btnLast');
  await waitResult(page);
  assert(state.vaultGets === 1 && state.vaultPosts === 0 && state.mantleDecr === 0 && state.posts === 0, 'last result must peek, not redeem', state);
  assert(state.urls.some((u) => u.startsWith('GET /get?quiz=soft&code=' + CODE)), 'peek url', state);
  const toast = await page.$eval('#toast', (el) => el.textContent);
  assert(toast.includes('不扣次'), toast);

  state.vaultGet = 'miss';
  await page.evaluate(() => showLast());
  for (let i = 0; i < 40 && state.mantleGets < 1; i++) await new Promise((r) => setTimeout(r, 50));
  assert(state.mantleGets === 1 && state.mantleDecr === 0, 'peek falls back to Mantle without decrement', state);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.click('#btnStart');
  await waitQuiz(page);
  assert(state.vaultPosts === 0, 'unlocked code tab must not redeem again on start', state);
  await fastFinish(page);
  await page.click('#btnRetry');
  await page.waitForSelector('#codeMask.show');
  const prefill = await page.$eval('#codeInput', (el) => el.value);
  assert(prefill === CODE, 'retry prefill ' + prefill);
  await page.click('#btnCodeOk');
  await waitQuiz(page);
  assert(state.vaultPosts === 1 && state.posts === 0 && state.mantleDecr === 0, 'code retry uses vault redeem', state);
  assert(errors.length === 0, errors.join('\n'));
  await page.close();
});

test('query string still redeems an order id or a legacy code', async (browser) => {
  const order = freshState();
  const p1 = await newPage(browser, order, { path: '?code=' + ORDER });
  await waitQuiz(p1.page);
  assert(order.posts === 1 && order.bodies[0].quiz === 'soft' && order.bodies[0].orderId === ORDER, 'query order', order);
  await p1.page.close();

  const code = freshState();
  const p2 = await newPage(browser, code, { path: '?code=' + CODE });
  await waitQuiz(p2.page);
  assert(code.vaultPosts === 1 && code.bodies[0].code === CODE && code.posts === 0, 'query code', code);
  await p2.page.close();
});

test('result peek not_found does not reveal a saved result', async (browser) => {
  const state = freshState();
  const { page } = await newPage(browser, state);
  await openAndSubmit(page, ORDER);
  await waitQuiz(page);
  await fastFinish(page);
  state.bound = false;
  state.uses = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('start').classList.contains('active'));
  const revealed = await page.evaluate(() => document.getElementById('result').classList.contains('active') || isUnlocked());
  assert(!revealed, 'not_found peek revealed the result');
  assert(state.posts === 1, 'not_found peek redeemed', state);
  await page.close();
});

test('layout at 320 and 390', async (browser) => {
  for (const width of [320, 390]) {
    const state = freshState();
    const { page, errors } = await newPage(browser, state, { viewport: { width, height: 780, isMobile: true, hasTouch: true } });
    let box = await overflow(page);
    assert(!box.overflow, width + ' start overflow ' + JSON.stringify(box));
    await shot(page, `soft-${width}-start.png`);
    await page.click('#btnStart');
    await page.waitForSelector('#codeMask.show');
    await page.$eval('#codeInput', (el, v) => { el.value = v; }, ORDER);
    box = await overflow(page);
    assert(!box.overflow, width + ' modal overflow ' + JSON.stringify(box));
    assert(box.inputFit === true, width + ' order id clipped in the field ' + JSON.stringify(box));
    const hint = await page.$eval('.code-hint', (el) => el.innerText);
    assert(hint.includes('我的订单') && hint.includes('3 次'), hint);
    await shot(page, `soft-${width}-order.png`);
    await page.evaluate(() => {
      closeCodeModal();
      renderResult(analyze({ R: 72, B: 41, C: 55 }));
      show('result');
    });
    box = await overflow(page);
    assert(!box.overflow, width + ' result overflow ' + JSON.stringify(box));
    const retry = await page.$eval('#btnRetry', (el) => el.textContent);
    assert(retry === '再测一次', retry);
    await shot(page, `soft-${width}-result.png`);
    assert(errors.length === 0, errors.join('\n'));
    await page.close();
  }
});

const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], {
  cwd: ROOT,
  stdio: 'ignore',
});
await new Promise((resolve) => setTimeout(resolve, 300));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--host-resolver-rules=MAP ${API_HOST} 127.0.0.1, MAP mantledb.sh 127.0.0.1`,
  ],
});

let failed = 0;
try {
  for (const c of cases) {
    try {
      await c.fn(browser);
      console.log('ok  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL ' + c.name);
      console.error(e && e.stack || e);
    }
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log(cases.length + ' passed');
