// 계산 로직 테스트 — `npm test` 로 실행 (의존성 없음, node:assert 사용)
const assert = require('node:assert/strict');
const {
  toMinutes,
  formatTime,
  getRemainingMinutes,
  calculatePlan,
  buildFallbackCopy,
  buildApiPayload,
  isValidSettings,
  validateFixedStep,
  validateWashStep,
  withTopic
} = require('../app.js');
const DATA = require('../data.js');

const settings = () => JSON.parse(JSON.stringify(DATA.DEFAULT_SETTINGS));
const at = (hhmm) => toMinutes(hhmm);
const names = (items) => items.map((item) => item.name);

let passed = 0;
function test(title, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${title}`);
  } catch (error) {
    console.error(`FAIL  ${title}`);
    throw error;
  }
}

// 기본값: 출발 08:40, 필수 준비 10분, 씻기 전체 30분

test('시간이 충분하면 전부 가능 (full)', () => {
  const plan = calculatePlan(settings(), at('07:50'));
  assert.equal(plan.status, 'full');
  assert.equal(plan.doneItems.length, 6);
  assert.equal(plan.finishAt, '08:30');
  assert.equal(plan.slackMinutes, 10);
  assert.equal(plan.dirtyScore, 0);
});

test('기획서 예시: 머리까지 사수 (partial)', () => {
  const plan = calculatePlan(settings(), at('08:15'));
  assert.equal(plan.status, 'partial');
  assert.deepEqual(names(plan.doneItems), ['세수', '양치', '머리 감기']);
  assert.equal(plan.finishAt, '08:38');
  assert.equal(plan.slackMinutes, 2);
  assert.equal(plan.dirtyScore, 50); // 한 일 10+15+25=50 / 활성 합계 100
});

test('필수 준비만 가능 (none)', () => {
  const plan = calculatePlan(settings(), at('08:28'));
  assert.equal(plan.status, 'none');
  assert.equal(plan.doneItems.length, 0);
  assert.equal(plan.slackMinutes, 2);
  assert.equal(plan.dirtyScore, 100);
});

test('필수 준비도 부족 (short)', () => {
  const plan = calculatePlan(settings(), at('08:32'));
  assert.equal(plan.status, 'short');
  assert.equal(plan.shortMinutes, 2);
  assert.equal(plan.slackMinutes, -2);
  assert.equal(plan.doneItems.length, 0);
});

test('출발 시각이 지났다 (passed)', () => {
  const plan = calculatePlan(settings(), at('08:45'));
  assert.equal(plan.status, 'passed');
  assert.equal(plan.doneItems.length, 0);
});

test('정확히 출발 시각이면 지난 것으로 본다', () => {
  assert.equal(calculatePlan(settings(), at('08:40')).status, 'passed');
});

test('자정 넘김: 23:50 에 일어나 00:30 출발', () => {
  const data = settings();
  data.departTime = '00:30';
  assert.equal(getRemainingMinutes(at('00:30'), at('23:50')), 40);
  const plan = calculatePlan(data, at('23:50'));
  assert.equal(plan.status, 'full');
  assert.equal(plan.finishAt, '00:30'); // 40분 = 필수 10 + 씻기 30, 딱 맞게 끝남
  assert.equal(plan.slackMinutes, 0);
});

test('formatTime 은 자정을 넘겨도 00:00~23:59', () => {
  assert.equal(formatTime(1440 + 5), '00:05');
  assert.equal(formatTime(-10), '23:50');
});

test('strict: 안 들어가는 항목에서 멈춘다 / greedy: 건너뛰고 계속', () => {
  // 남은 21분 - 필수 10분 = 11분: 세수3+양치3=6, 머리 감기 7 은 13>11 → 안 들어감, 머리 말리기 5 는 11<=11
  const strict = calculatePlan(settings(), at('08:19'), 'strict');
  assert.deepEqual(names(strict.doneItems), ['세수', '양치']);
  const greedy = calculatePlan(settings(), at('08:19'), 'greedy');
  assert.deepEqual(names(greedy.doneItems), ['세수', '양치', '머리 말리기']);
});

test('우선순위 숫자 순서대로 정렬해서 채운다', () => {
  const data = settings();
  data.washItems.find((item) => item.id === 'body').priority = 1;
  data.washItems.find((item) => item.id === 'face').priority = 4;
  const plan = calculatePlan(data, at('08:15')); // 가용 15분: 몸 씻기 8 + 양치 3 + 머리 감기 7 = 18 > 15
  assert.deepEqual(names(plan.doneItems), ['몸 씻기', '양치']);
});

test('체크 해제한 항목은 후보에서 빠진다', () => {
  const data = settings();
  data.washItems.find((item) => item.id === 'hair').enabled = false;
  const plan = calculatePlan(data, at('08:15'));
  assert.ok(!names(plan.doneItems).includes('머리 감기'));
  assert.ok(!names(plan.excludedItems).includes('머리 감기'));
});

test('꼬질도는 활성 항목 기준 비율이다', () => {
  const plan = calculatePlan(settings(), at('08:15'));
  // 활성 합계 100, 한 일 10+15+25=50 → 꼬질도 50
  assert.equal(plan.dirtyScore, 50);
  assert.equal(plan.dirtyLevel.label, '무난');
});

test('기본 문구: 상태별 코스 이름과 은/는 처리', () => {
  const plan = calculatePlan(settings(), at('08:15'));
  const copy = buildFallbackCopy(plan, 'playful');
  assert.equal(copy.courseName, '머리 감기까지 사수 코스');
  assert.ok(copy.giveUpNote.startsWith('몸 씻기·머리 말리기·스킨케어는'));
  assert.equal(withTopic('양치'), '양치는');
  assert.equal(withTopic('몸'), '몸은');
});

test('기본 문구: 모든 상태·말투에 빈 문자열이 없다', () => {
  const cases = ['07:50', '08:15', '08:28', '08:32', '08:45'];
  for (const tone of ['sweet', 'playful']) {
    for (const time of cases) {
      const copy = buildFallbackCopy(calculatePlan(settings(), at(time)), tone);
      Object.values(copy).forEach((text) => {
        assert.ok(text.trim().length > 0, `${tone}/${time}`);
        assert.ok(!text.includes('{'), `치환 안 된 변수: ${text}`);
      });
    }
  }
});

test('API payload 는 계산 결과만 담는다 (id·cleanPoints 제외)', () => {
  const payload = buildApiPayload(calculatePlan(settings(), at('08:15')), 'sweet');
  assert.deepEqual(payload.doneItems[0], { name: '세수', minutes: 3 });
  assert.equal(payload.tone, 'sweet');
  assert.ok(!('settings' in payload));
});

test('설정 검증: 기본값은 통과, 깨진 값은 거절', () => {
  assert.equal(isValidSettings(settings()), true);
  const broken = settings();
  broken.departTime = '25:00';
  assert.equal(isValidSettings(broken), false);
  assert.equal(isValidSettings(null), false);
});

test('온보딩 검증 메시지', () => {
  const data = settings();
  assert.equal(validateFixedStep(data), '');
  data.fixedPrep = [];
  assert.notEqual(validateFixedStep(data), '');
  data.washItems.forEach((item) => {
    item.enabled = false;
  });
  assert.notEqual(validateWashStep(data), '');
});

console.log(`\n${passed}개 통과`);
