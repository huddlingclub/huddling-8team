// 씻을까? — 기본 데이터·기본 문구 (data.js)
// 브라우저에서는 전역 상수 SSITGGA_DATA 로, Node 테스트에서는 module.exports 로 쓴다.
// 화면 문구·예시 데이터를 고치고 싶다면 이 파일만 수정하면 된다.

const SSITGGA_DATA = {
  // localStorage 키 (스키마가 바뀌면 v2 로 올린다)
  STORAGE_KEY: 'ssitgga:v1',

  // 씻기 항목 채우는 방식
  // 'strict': 우선순위 순서대로 채우다가 처음 안 들어가는 항목에서 멈춘다 (기본)
  // 'greedy': 안 들어가는 항목은 건너뛰고, 뒤의 작은 항목이 들어가면 계속 채운다
  FILL_STRATEGY: 'strict',

  // 서버 AI 호출을 기다리는 최대 시간(ms). 넘으면 기본 문구로 즉시 보여준다.
  API_TIMEOUT_MS: 2500,
  API_URL: '/api/message',

  // 온보딩 기본값
  DEFAULT_SETTINGS: {
    departTime: '08:40',
    tone: 'playful',
    fixedPrep: [
      { id: 'dress', name: '옷 입기', minutes: 7 },
      { id: 'bag', name: '짐 챙기기', minutes: 3 }
    ],
    // cleanPoints: 이 항목을 하면 줄어드는 꼬질도 비중 (활성 항목끼리 합산해서 비율로 계산)
    washItems: [
      { id: 'face', name: '세수', minutes: 3, priority: 1, enabled: true, cleanPoints: 10 },
      { id: 'teeth', name: '양치', minutes: 3, priority: 2, enabled: true, cleanPoints: 15 },
      { id: 'hair', name: '머리 감기', minutes: 7, priority: 3, enabled: true, cleanPoints: 25 },
      { id: 'body', name: '몸 씻기', minutes: 8, priority: 4, enabled: true, cleanPoints: 25 },
      { id: 'dry', name: '머리 말리기', minutes: 5, priority: 5, enabled: true, cleanPoints: 15 },
      { id: 'skin', name: '스킨케어', minutes: 4, priority: 6, enabled: true, cleanPoints: 10 }
    ]
  },

  // 사용자가 직접 추가한 항목의 기본 꼬질도 비중
  CUSTOM_ITEM_CLEAN_POINTS: 10,

  // 꼬질도 단계 (dirtyScore <= max 인 첫 단계)
  DIRTY_LEVELS: [
    { max: 10, label: '반짝반짝', emoji: '✨', comment: '지금 당장 소개팅 가도 됨' },
    { max: 35, label: '말끔', emoji: '🫧', comment: '남들은 눈치 못 챌 정도' },
    { max: 60, label: '무난', emoji: '🙂', comment: '가까이만 안 가면 괜찮음' },
    { max: 85, label: '꼬질', emoji: '🐿️', comment: '모자 하나 챙기자' },
    { max: 100, label: '동굴 거주자', emoji: '🦧', comment: '오늘은 거리두기 모드' }
  ],

  // AI 가 실패하거나 늦을 때 보여줄 기본 문구
  // 치환 변수: {last} 마지막으로 하는 항목, {excludedTopic} 포기 항목+은/는, {short} 부족한 분, {slack} 여유 분
  FALLBACK_COPY: {
    sweet: {
      full: {
        courseName: '풀코스 여유 만끽 코스',
        summary: '오늘은 여유로워. 천천히 다 씻고 나가자.',
        giveUpNote: '포기할 항목 없음!'
      },
      partial: {
        courseName: '{last}까지 사수 코스',
        summary: '{last}까지는 할 수 있어. 조금만 부지런히 움직이자.',
        giveUpNote: '{excludedTopic} 오늘은 쉬어가자.'
      },
      none: {
        courseName: '출발 준비 직행 코스',
        summary: '오늘은 씻을 시간이 없어. 옷만 입고 바로 나가자.',
        giveUpNote: '{excludedTopic} 다음에 꼭 챙겨줄게.'
      },
      short: {
        courseName: '일단 나가는 게 먼저 코스',
        summary: '준비 시간만으로도 {short}분이 모자라. 서두르자.',
        giveUpNote: '씻기는 오늘 전부 패스야.'
      },
      passed: {
        courseName: '이미 출발할 시간 코스',
        summary: '출발 시각이 지났어. 지금 바로 나가자.',
        giveUpNote: '씻기는 오늘 전부 패스야.'
      }
    },
    playful: {
      full: {
        courseName: '왕족 목욕 코스',
        summary: '시간이 남아돌아. 오늘은 거울 속 나한테 인사까지 하고 나가.',
        giveUpNote: '포기할 건 침대뿐!'
      },
      partial: {
        courseName: '{last}까지 사수 코스',
        summary: '{last}까지 가능해. 대신 침대랑은 지금 작별하자.',
        giveUpNote: '{excludedTopic} 오늘 제외. 향수로 어떻게든 해보자.'
      },
      none: {
        courseName: '고양이 세수도 사치 코스',
        summary: '씻을 틈이 없어. 옷 입고 도망치듯 나가자.',
        giveUpNote: '{excludedTopic} 전부 반납!'
      },
      short: {
        courseName: '일단 뛰어 코스',
        summary: '준비만 해도 {short}분이 모자라. 전력 질주 각이야.',
        giveUpNote: '씻기는 오늘 전부 반납!'
      },
      passed: {
        courseName: '이미 늦었다 코스',
        summary: '출발 시각이 지났어. 변명은 가면서 생각하자.',
        giveUpNote: '씻기는 오늘 전부 반납!'
      }
    }
  },

  // 여유 시간에 따른 재촉 문구 (tight: 2분 이하, normal: 10분 이하, relaxed: 그 이상, late: 늦음)
  NUDGE: {
    sweet: {
      tight: '지금 바로 시작하자. 한 박자도 아까워.',
      normal: '조금만 서두르면 충분해. 천천히, 그래도 지금 일어나자.',
      relaxed: '여유 있으니까 숨 한 번 쉬고 시작해도 돼.',
      late: '괜찮아, 일단 움직이자.'
    },
    playful: {
      tight: '1초가 아까워! 폰 내려놓고 욕실로 직행!',
      normal: '느긋해 보이지? 아니야, 지금 일어나야 해.',
      relaxed: '여유 만만이지만 이불은 이미 적이야.',
      late: '이미 늦었어, 신발부터 신자!'
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SSITGGA_DATA;
}
