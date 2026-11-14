// 씻을까? — 계산 로직 + 화면 동작 (app.js)
// 1) 위쪽: DOM 에 의존하지 않는 순수 계산 함수 (Node 테스트 가능)
// 2) 아래쪽: 화면 이동·폼·API 호출

const DATA = typeof SSITGGA_DATA !== 'undefined' ? SSITGGA_DATA : require('./data.js');

/* ------------------------------------------------------------------ */
/* 1. 시간 유틸                                                         */
/* ------------------------------------------------------------------ */

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toMinutes(hhmm) {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatTime(totalMinutes) {
  // 자정을 넘겨도 00:00~23:59 로 보이도록 보정
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0');
  const minutes = String(normalized % 60).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function getNowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

// 출발까지 남은 분. 출발 시각이 12시간 넘게 과거면 '다음 날 출발'(자정 넘김)로 본다.
function getRemainingMinutes(departMinutes, nowMinutes) {
  let diff = departMinutes - nowMinutes;
  if (diff < -720) {
    diff += 1440;
  }
  return diff;
}

/* ------------------------------------------------------------------ */
/* 2. 핵심 계산: 남은 시간 → 가능한 씻기 항목                             */
/* ------------------------------------------------------------------ */

function sumMinutes(items) {
  return items.reduce((sum, item) => sum + item.minutes, 0);
}

// status: full(전부 가능) | partial(일부 가능) | none(씻기 불가, 필수 준비만 가능)
//         short(필수 준비도 부족) | passed(출발 시각 지남)
function calculatePlan(settings, nowMinutes, strategy = DATA.FILL_STRATEGY) {
  const departMinutes = toMinutes(settings.departTime);
  const remainingMinutes = getRemainingMinutes(departMinutes, nowMinutes);
  const fixedMinutes = sumMinutes(settings.fixedPrep);
  const availableMinutes = remainingMinutes - fixedMinutes;

  const candidates = settings.washItems
    .filter((item) => item.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  const doneItems = [];
  const excludedItems = [];
  let washMinutes = 0;

  for (const item of candidates) {
    const stopped = strategy === 'strict' && excludedItems.length > 0;
    if (!stopped && washMinutes + item.minutes <= availableMinutes) {
      doneItems.push(item);
      washMinutes += item.minutes;
    } else {
      excludedItems.push(item);
    }
  }

  let status;
  if (remainingMinutes <= 0) {
    status = 'passed';
  } else if (availableMinutes < 0) {
    status = 'short';
  } else if (doneItems.length === 0) {
    status = 'none';
  } else if (excludedItems.length === 0) {
    status = 'full';
  } else {
    status = 'partial';
  }

  // 꼬질도: 활성 항목의 cleanPoints 중 못 한 비율 (0=반짝, 100=동굴)
  const totalPoints = candidates.reduce((sum, item) => sum + item.cleanPoints, 0);
  const donePoints = doneItems.reduce((sum, item) => sum + item.cleanPoints, 0);
  const dirtyScore = totalPoints === 0 ? 0 : Math.round((1 - donePoints / totalPoints) * 100);
  const dirtyLevel = DATA.DIRTY_LEVELS.find((level) => dirtyScore <= level.max);

  return {
    status,
    nowTime: formatTime(nowMinutes),
    departTime: settings.departTime,
    remainingMinutes,
    fixedMinutes,
    availableMinutes,
    washMinutes,
    shortMinutes: status === 'short' ? -availableMinutes : 0,
    finishAt: formatTime(nowMinutes + fixedMinutes + washMinutes),
    slackMinutes: remainingMinutes - fixedMinutes - washMinutes,
    doneItems,
    excludedItems,
    dirtyScore,
    dirtyLevel
  };
}

/* ------------------------------------------------------------------ */
/* 3. 문구: 기본 문구 + API 요청/응답                                    */
/* ------------------------------------------------------------------ */

// 마지막 글자에 받침이 있으면 true (한글 외에는 false)
function hasBatchim(text) {
  const code = text.charCodeAt(text.length - 1);
  if (code < 0xac00 || code > 0xd7a3) {
    return false;
  }
  return (code - 0xac00) % 28 !== 0;
}

function withTopic(text) {
  return text + (hasBatchim(text) ? '은' : '는');
}

function getNudgeKey(plan) {
  if (plan.status === 'passed' || plan.status === 'short') {
    return 'late';
  }
  if (plan.slackMinutes <= 2) {
    return 'tight';
  }
  return plan.slackMinutes <= 10 ? 'normal' : 'relaxed';
}

function buildFallbackCopy(plan, tone) {
  const copyByTone = DATA.FALLBACK_COPY[tone] || DATA.FALLBACK_COPY.sweet;
  const entry = copyByTone[plan.status];
  const lastItem = plan.doneItems[plan.doneItems.length - 1];
  const excludedNames = plan.excludedItems.map((item) => item.name).join('·');

  const variables = {
    last: lastItem ? lastItem.name : '',
    excludedTopic: excludedNames ? withTopic(excludedNames) : '',
    short: String(plan.shortMinutes),
    slack: String(plan.slackMinutes)
  };
  const fill = (template) =>
    template.replace(/\{(\w+)\}/g, (_, key) => (key in variables ? variables[key] : ''));

  return {
    courseName: fill(entry.courseName),
    summary: fill(entry.summary),
    giveUpNote: fill(entry.giveUpNote),
    nudge: (DATA.NUDGE[tone] || DATA.NUDGE.sweet)[getNudgeKey(plan)]
  };
}

// 서버(AI)로 보내는 값: 이미 계산이 끝난 결과만 보낸다.
function buildApiPayload(plan, tone) {
  const pick = (item) => ({ name: item.name, minutes: item.minutes });
  return {
    tone,
    status: plan.status,
    remainingMinutes: plan.remainingMinutes,
    fixedMinutes: plan.fixedMinutes,
    shortMinutes: plan.shortMinutes,
    finishAt: plan.finishAt,
    slackMinutes: plan.slackMinutes,
    doneItems: plan.doneItems.map(pick),
    excludedItems: plan.excludedItems.map(pick),
    dirtyScore: plan.dirtyScore
  };
}

function isValidCopy(copy) {
  const keys = ['courseName', 'summary', 'giveUpNote', 'nudge'];
  return (
    copy !== null &&
    typeof copy === 'object' &&
    keys.every((key) => typeof copy[key] === 'string' && copy[key].trim().length > 0)
  );
}

async function fetchAiCopy(payload) {
  // 파일을 더블클릭해서 연 경우(file://)에는 서버가 없으므로 바로 기본 문구로 간다.
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA.API_TIMEOUT_MS);
  try {
    const response = await fetch(DATA.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return isValidCopy(data.copy) ? data.copy : null;
  } catch (error) {
    // 네트워크 오류·타임아웃은 기본 문구로 대체하므로 사용자에게 에러를 보여주지 않는다.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 4. 설정 저장/검증                                                    */
/* ------------------------------------------------------------------ */

function cloneSettings(settings) {
  return JSON.parse(JSON.stringify(settings));
}

function isValidMinutes(value) {
  return Number.isInteger(value) && value >= 1 && value <= 120;
}

// 저장된 값이 깨져 있어도 앱이 죽지 않도록 모양을 검사한다.
function isValidSettings(settings) {
  if (!settings || !isValidTime(settings.departTime)) {
    return false;
  }
  if (!['sweet', 'playful'].includes(settings.tone)) {
    return false;
  }
  const fixedOk =
    Array.isArray(settings.fixedPrep) &&
    settings.fixedPrep.every((item) => item.name && isValidMinutes(item.minutes));
  const washOk =
    Array.isArray(settings.washItems) &&
    settings.washItems.every(
      (item) =>
        item.name &&
        isValidMinutes(item.minutes) &&
        Number.isInteger(item.priority) &&
        typeof item.enabled === 'boolean' &&
        Number.isFinite(item.cleanPoints)
    );
  return fixedOk && washOk;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(DATA.STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return isValidSettings(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(DATA.STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    return false;
  }
}

// 단계별 입력 검증. 문제가 없으면 빈 문자열을 반환한다.
function validateFixedStep(draft) {
  if (!isValidTime(draft.departTime)) {
    return '나갈 시각을 HH:MM 형식으로 입력해줘.';
  }
  if (draft.fixedPrep.length === 0) {
    return '필수 준비를 하나 이상 추가해줘. (예: 옷 입기)';
  }
  return '';
}

function validateWashStep(draft) {
  if (!draft.washItems.some((item) => item.enabled)) {
    return '씻기 항목을 하나 이상 체크해줘.';
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* 5. 화면 (브라우저에서만 실행)                                         */
/* ------------------------------------------------------------------ */

const state = {
  settings: null, // 저장된 설정
  draft: null, // 온보딩 편집 중인 설정
  nowOverride: null, // 테스트용 현재 시각 ("HH:MM")
  lastPlan: null,
  requestId: 0, // 오래된 API 응답이 새 결과를 덮어쓰지 않게 하는 번호
  clockTimer: null
};

function $(selector) {
  return document.querySelector(selector);
}

// 사용자 입력은 textContent 로만 넣어서 XSS 를 막는다.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (key === 'className') {
      node.className = value;
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key in node) {
      node[key] = value;
    } else {
      node.setAttribute(key, value);
    }
  });
  children.flat().forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function getNow() {
  if (state.nowOverride && isValidTime(state.nowOverride)) {
    return toMinutes(state.nowOverride);
  }
  return getNowMinutes();
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.hidden = screen.dataset.screen !== name;
  });
  $('#btn-open-settings').hidden = !(name === 'home' || name === 'result');
  if (name === 'home') {
    renderHome();
    startClock();
  } else {
    stopClock();
  }
  window.scrollTo(0, 0);
}

function startClock() {
  stopClock();
  state.clockTimer = setInterval(renderHome, 15000);
}

function stopClock() {
  if (state.clockTimer) {
    clearInterval(state.clockTimer);
    state.clockTimer = null;
  }
}

function showError(selector, message) {
  const target = $(selector);
  target.textContent = message;
  target.hidden = message === '';
}

/* ---- 온보딩 1: 고정 시간 ---- */

function createStepper(id, minutes, action) {
  return el(
    'div',
    { className: 'stepper' },
    el('button', { type: 'button', className: 'icon-btn', ariaLabel: '1분 줄이기', dataset: { action: `${action}-minus`, id } }, '−'),
    el('span', { className: 'stepper-value' }, `${minutes}분`),
    el('button', { type: 'button', className: 'icon-btn', ariaLabel: '1분 늘리기', dataset: { action: `${action}-plus`, id } }, '+')
  );
}

function renderFixedList() {
  const list = $('#list-fixed');
  list.replaceChildren(
    ...state.draft.fixedPrep.map((item) =>
      el(
        'li',
        { className: 'row' },
        el('span', { className: 'row-name' }, item.name),
        createStepper(item.id, item.minutes, 'fixed'),
        el('button', { type: 'button', className: 'icon-btn danger', ariaLabel: `${item.name} 삭제`, dataset: { action: 'fixed-remove', id: item.id } }, '×')
      )
    )
  );
  const total = sumMinutes(state.draft.fixedPrep);
  $('#fixed-total').replaceChildren('필수 준비 합계', el('strong', {}, `${total}분`));
}

function renderFixedStep() {
  $('#input-depart').value = state.draft.departTime;
  showError('#error-fixed', '');
  renderFixedList();
  showScreen('onboarding-fixed');
}

function handleFixedClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) {
    return;
  }
  const { action, id } = button.dataset;
  const item = state.draft.fixedPrep.find((entry) => entry.id === id);
  if (!item) {
    return;
  }
  if (action === 'fixed-minus') {
    item.minutes = Math.max(1, item.minutes - 1);
  } else if (action === 'fixed-plus') {
    item.minutes = Math.min(120, item.minutes + 1);
  } else if (action === 'fixed-remove') {
    state.draft.fixedPrep = state.draft.fixedPrep.filter((entry) => entry.id !== id);
  }
  renderFixedList();
}

function handleAddFixed(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.elements.name.value.trim();
  const minutes = Number(form.elements.minutes.value);
  if (!name || !isValidMinutes(minutes)) {
    showError('#error-fixed', '이름과 1~120분 사이의 시간을 입력해줘.');
    return;
  }
  state.draft.fixedPrep.push({ id: `fixed-${Date.now()}`, name, minutes });
  form.reset();
  form.elements.minutes.value = 5;
  showError('#error-fixed', '');
  renderFixedList();
}

function handleNextFixed() {
  state.draft.departTime = $('#input-depart').value;
  const message = validateFixedStep(state.draft);
  showError('#error-fixed', message);
  if (message === '') {
    renderWashStep();
  }
}

/* ---- 온보딩 2: 씻기 체크리스트 ---- */

function getSortedWash() {
  return state.draft.washItems.slice().sort((a, b) => a.priority - b.priority);
}

// 화면에 보이는 순서대로 priority 를 1부터 다시 매긴다.
function reindexPriority(sorted) {
  sorted.forEach((item, index) => {
    item.priority = index + 1;
  });
}

function renderWashList() {
  const sorted = getSortedWash();
  const list = $('#list-wash');
  list.replaceChildren(
    ...sorted.map((item, index) =>
      el(
        'li',
        { className: `row${item.enabled ? '' : ' is-off'}` },
        el('span', { className: 'rank' }, String(index + 1)),
        el('input', { type: 'checkbox', checked: item.enabled, ariaLabel: `${item.name} 사용`, dataset: { action: 'wash-toggle', id: item.id } }),
        el('span', { className: 'row-name' }, item.name),
        createStepper(item.id, item.minutes, 'wash'),
        el('div', { className: 'order-btns' },
          el('button', { type: 'button', className: 'icon-btn', disabled: index === 0, ariaLabel: `${item.name} 우선순위 올리기`, dataset: { action: 'wash-up', id: item.id } }, '↑'),
          el('button', { type: 'button', className: 'icon-btn', disabled: index === sorted.length - 1, ariaLabel: `${item.name} 우선순위 내리기`, dataset: { action: 'wash-down', id: item.id } }, '↓')
        ),
        el('button', { type: 'button', className: 'icon-btn danger', ariaLabel: `${item.name} 삭제`, dataset: { action: 'wash-remove', id: item.id } }, '×')
      )
    )
  );
  const total = sumMinutes(sorted.filter((item) => item.enabled));
  $('#wash-total').replaceChildren('선택한 씻기 전체', el('strong', {}, `${total}분`));
}

function renderWashStep() {
  showError('#error-wash', '');
  renderWashList();
  showScreen('onboarding-wash');
}

function handleWashClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) {
    return;
  }
  const { action, id } = target.dataset;
  const sorted = getSortedWash();
  const index = sorted.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return;
  }
  const item = sorted[index];

  if (action === 'wash-minus') {
    item.minutes = Math.max(1, item.minutes - 1);
  } else if (action === 'wash-plus') {
    item.minutes = Math.min(120, item.minutes + 1);
  } else if (action === 'wash-up' && index > 0) {
    [sorted[index - 1], sorted[index]] = [sorted[index], sorted[index - 1]];
    reindexPriority(sorted);
  } else if (action === 'wash-down' && index < sorted.length - 1) {
    [sorted[index + 1], sorted[index]] = [sorted[index], sorted[index + 1]];
    reindexPriority(sorted);
  } else if (action === 'wash-remove') {
    state.draft.washItems = state.draft.washItems.filter((entry) => entry.id !== id);
    reindexPriority(getSortedWash());
  } else if (action === 'wash-toggle') {
    item.enabled = target.checked;
  }
  renderWashList();
}

function handleAddWash(event) {
  event.preventDefault();
  const form = event.target;
  const name = form.elements.name.value.trim();
  const minutes = Number(form.elements.minutes.value);
  if (!name || !isValidMinutes(minutes)) {
    showError('#error-wash', '이름과 1~120분 사이의 시간을 입력해줘.');
    return;
  }
  state.draft.washItems.push({
    id: `wash-${Date.now()}`,
    name,
    minutes,
    priority: state.draft.washItems.length + 1,
    enabled: true,
    cleanPoints: DATA.CUSTOM_ITEM_CLEAN_POINTS
  });
  form.reset();
  form.elements.minutes.value = 5;
  showError('#error-wash', '');
  renderWashList();
}

function handleFinishOnboarding() {
  const message = validateWashStep(state.draft);
  showError('#error-wash', message);
  if (message !== '') {
    return;
  }
  reindexPriority(getSortedWash());
  state.settings = cloneSettings(state.draft);
  if (!saveSettings(state.settings)) {
    // 저장이 막힌 환경(시크릿 모드 등)에서도 이번 방문에는 계속 쓸 수 있다.
    showError('#error-wash', '브라우저 저장이 막혀 있어서 이번 방문에만 설정이 유지돼.');
  }
  showScreen('home');
}

/* ---- 홈 ---- */

function renderHome() {
  const nowMinutes = getNow();
  const remaining = getRemainingMinutes(toMinutes(state.settings.departTime), nowMinutes);
  $('#home-now').textContent = formatTime(nowMinutes);
  $('#home-depart').textContent = state.settings.departTime;
  $('#home-remaining').textContent = remaining > 0 ? `출발까지 ${remaining}분` : '출발 시각이 지났어';
}

/* ---- 결과 ---- */

function renderItemList(selector, items, emptyText, isExcluded) {
  const list = $(selector);
  if (items.length === 0) {
    list.replaceChildren(el('li', { className: 'empty' }, emptyText));
    return;
  }
  list.replaceChildren(
    ...items.map((item) =>
      el(
        'li',
        { className: isExcluded ? 'chip chip-off' : 'chip chip-on' },
        el('span', {}, isExcluded ? '✕' : '✓'),
        el('span', { className: 'chip-name' }, item.name),
        el('span', { className: 'chip-min' }, `${item.minutes}분`)
      )
    )
  );
}

function renderSlack(plan) {
  if (plan.status === 'passed') {
    return `${plan.departTime} 출발 시각 지남`;
  }
  if (plan.slackMinutes < 0) {
    return `출발까지 ${-plan.slackMinutes}분 부족`;
  }
  return `출발까지 ${plan.slackMinutes}분 여유`;
}

function renderCopy(copy, source) {
  $('#result-course').textContent = copy.courseName;
  $('#result-summary').textContent = copy.summary;
  $('#result-giveup').textContent = copy.giveUpNote;
  $('#result-nudge').textContent = copy.nudge;
  $('#result-source').textContent = source === 'ai' ? 'AI가 쓴 문구' : '기본 문구';
  $('#result-copy').classList.remove('is-loading');
}

// 꼬질도에 맞는 결과 단계(뽀송·무난·꼬질)와 펭귄 그림을 고른다.
function getResultTier(plan) {
  const tier = DATA.RESULT_TIERS.find((entry) => plan.dirtyScore <= entry.max);
  const isLate = plan.status === 'passed' || plan.status === 'short';
  return {
    key: tier.key,
    title: tier.title,
    label: tier.label,
    emoji: tier.emoji,
    comment: tier.comment,
    image: isLate ? DATA.LATE_IMAGE.image : tier.image,
    alt: isLate ? DATA.LATE_IMAGE.alt : tier.alt
  };
}

function renderResultNumbers(plan) {
  const tier = getResultTier(plan);
  $('[data-screen="result"]').dataset.tier = tier.key;
  $('#result-tier').textContent = tier.title;
  $('#result-image').src = tier.image;
  $('#result-image').alt = tier.alt;

  // 시간·항목은 항상 앱의 계산값만 쓴다. (AI 응답은 문구에만 사용)
  $('#result-detail').textContent =
    plan.status === 'passed'
      ? renderSlack(plan)
      : `${plan.finishAt} 준비 완료 예상 · ${renderSlack(plan)}`;
  $('#result-chip').textContent = `${plan.nowTime} 기준 · 남은 ${Math.max(plan.remainingMinutes, 0)}분`;
  renderItemList('#result-done', plan.doneItems, '오늘은 씻을 시간이 없어', false);
  renderItemList('#result-excluded', plan.excludedItems, '포기할 항목 없음', true);

  $('#meter-fill').style.width = `${plan.dirtyScore}%`;
  $('#dirty-emoji').textContent = tier.emoji;
  $('#dirty-label').textContent = `${tier.label} (${plan.dirtyScore}%)`;
  $('#dirty-comment').textContent = tier.comment;
}

function syncToneButtons() {
  document.querySelectorAll('[data-tone]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.tone === state.settings.tone));
  });
}

async function loadCopyForPlan(plan) {
  const requestId = ++state.requestId;
  const tone = state.settings.tone;
  const fallback = buildFallbackCopy(plan, tone);

  // 숫자·항목은 즉시 보이고, 문구 영역만 잠깐 로딩 표시
  $('#result-copy').classList.add('is-loading');
  const aiCopy = await fetchAiCopy(buildApiPayload(plan, tone));

  if (requestId !== state.requestId) {
    return; // 그 사이 다시 눌렀거나 말투를 바꿈
  }
  renderCopy(aiCopy || fallback, aiCopy ? 'ai' : 'fallback');
}

function showResult() {
  const plan = calculatePlan(state.settings, getNow());
  state.lastPlan = plan;
  renderResultNumbers(plan);
  syncToneButtons();
  showScreen('result');
  loadCopyForPlan(plan);
}

function handleToneChange(event) {
  const button = event.target.closest('[data-tone]');
  if (!button || button.dataset.tone === state.settings.tone) {
    return;
  }
  state.settings.tone = button.dataset.tone;
  saveSettings(state.settings);
  syncToneButtons();
  loadCopyForPlan(state.lastPlan);
}

/* ---- 설정 수정 / 테스트용 시각 ---- */

function openSettings() {
  state.draft = cloneSettings(state.settings);
  renderFixedStep();
}

function handleNowOverride(event) {
  state.nowOverride = event.target.value || null;
  renderHome();
}

function clearNowOverride() {
  state.nowOverride = null;
  $('#input-now-override').value = '';
  renderHome();
}

function initApp() {
  state.settings = loadSettings();

  $('#list-fixed').addEventListener('click', handleFixedClick);
  $('#form-add-fixed').addEventListener('submit', handleAddFixed);
  $('#btn-next-fixed').addEventListener('click', handleNextFixed);

  $('#list-wash').addEventListener('click', handleWashClick);
  $('#list-wash').addEventListener('change', handleWashClick);
  $('#form-add-wash').addEventListener('submit', handleAddWash);
  $('#btn-back-wash').addEventListener('click', renderFixedStep);
  $('#btn-finish-onboarding').addEventListener('click', handleFinishOnboarding);

  $('#btn-wash').addEventListener('click', showResult);
  $('#btn-open-settings').addEventListener('click', openSettings);
  $('#btn-retry').addEventListener('click', () => showScreen('home'));
  $('#tone-toggle').addEventListener('click', handleToneChange);

  $('#input-now-override').addEventListener('input', handleNowOverride);
  $('#btn-clear-override').addEventListener('click', clearNowOverride);

  // 스플래시를 잠깐 보여준 뒤, 설정이 있으면 홈으로, 없으면 온보딩으로 넘어간다.
  document.documentElement.style.setProperty('--splash-ms', `${DATA.SPLASH_MS}ms`);
  showScreen('splash');
  setTimeout(() => {
    if (state.settings) {
      showScreen('home');
    } else {
      state.draft = cloneSettings(DATA.DEFAULT_SETTINGS);
      renderFixedStep();
    }
  }, DATA.SPLASH_MS);
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toMinutes,
    formatTime,
    getRemainingMinutes,
    calculatePlan,
    getResultTier,
    buildFallbackCopy,
    buildApiPayload,
    isValidSettings,
    validateFixedStep,
    validateWashStep,
    hasBatchim,
    withTopic
  };
}
