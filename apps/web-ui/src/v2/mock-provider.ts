const cover = (name: string): string => new URL(`./assets/content/${name}`, import.meta.url).href;
type BookRow = readonly [string, string, string, string, number, string];
type ContentRow = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  readonly string[],
  string,
  string,
];
type InteractionRow = readonly [
  string,
  '评论' | '私信',
  string,
  string,
  string,
  string,
  '可直接确认' | '需要追问',
];
type PlanRow = readonly [string, string, string, string, string, string, string];

// One deterministic fixture record per line is easier to audit.
// prettier-ignore
const bookRows: readonly BookRow[] = [
  ['morgue', '莫格街凶杀案', '埃德加·爱伦·坡', '密室原点', 6, '12.4%'],
  ['hound', '巴斯克维尔的猎犬', '阿瑟·柯南·道尔', '理性对抗传说', 5, '10.8%'],
  ['moonstone', '月亮宝石', '威尔基·柯林斯', '不可靠叙述', 4, '14.1%'],
  ['yellow', '黄色房间的秘密', '加斯东·勒鲁', '封闭空间', 3, '11.7%'],
  ['red-headed', '红发会', '阿瑟·柯南·道尔', '日常里的圈套', 2, '9.6%'],
  ['four-sign', '四签名', '阿瑟·柯南·道尔', '旧案与追踪', 3, '10.2%'],
];

// These are the approved six-field content packages, not live content.
// prettier-ignore
const contentRows: readonly ContentRow[] = [
  ['morgue', '《莫格街凶杀案》', 'morgue-cover.png', '雾夜巴黎街巷与亮灯窗户的封面建议', '密室诞生之前，侦探小说先学会了观察', '读这篇故事最有意思的地方，不是等一个答案，而是看杜宾如何把混乱一点点拆开。真正锋利的不是运气，是他对细节近乎不讲情面的耐心。', '重点复核', ['推理小说', '公版经典', '密室'], '周四 20:00', '复古街灯、旧报纸纹理；封面不出现凶手身份。'],
  ['yellow-room', '《黄色房间的秘密》', 'yellow-room-cover.png', '黄色密室门与棋盘地面的封面建议', '一扇锁死的门，为什么比凶手更有吸引力', '好的密室不是把出口藏起来，而是让你确信根本没有出口。黄色房间最狡猾的一步，是先让读者相信空间本身不会说谎。', '时间冲突', ['密室推理', '阅读清单', '经典'], '周五 20:00', '黄色房门、棋盘地面；保留醒目的剧透警告。'],
  ['moonstone', '《月亮宝石》', 'moonstone-cover.png', '月光下蓝色宝石与旧账簿的封面建议', '第一部现代侦探长篇，早就会玩不可靠叙述', '每个人都讲了一点真话，也都漏掉了一点关键。读《月亮宝石》像在听一桌人轮流作证：越诚恳，越值得怀疑。', '待确认', ['月亮宝石', '侦探小说', '不可靠叙述'], '周六 14:00', '深蓝宝石、旧宅剪影；避免使用真人影视剧照。'],
];

// Fixed IDs and order make interaction state reproducible.
// prettier-ignore
const interactionRows: readonly InteractionRow[] = [
  ['comment-1', '评论', '纸上迷雾', '《莫格街凶杀案》那篇', '第一次读古典推理，怕太难进入，有推荐顺序吗？', '可以先从《莫格街凶杀案》开始，篇幅短、观察过程清楚。喜欢这种节奏，再接《四签名》。', '可直接确认'],
  ['comment-2', '评论', '书页侦探', '密室主题笔记', '黄色房间现在读还好看吗？', '把它当密室教科书读，会更有趣。', '可直接确认'],
  ['comment-3', '评论', '夜航读者', '本周书单', '想看反转多一点的，最推荐哪本？', '如果更在意叙述反转，我会先推《月亮宝石》。', '可直接确认'],
  ['comment-4', '评论', '解谜者', '密室主题笔记', '密室系列还会继续吗？', '会，下一篇会聊空间线索如何误导判断。', '可直接确认'],
  ['comment-5', '评论', '旧书签', '经典书单', '短篇适合从哪本开始？', '可以从《莫格街凶杀案》开始，篇幅和节奏都更友好。', '可直接确认'],
  ['comment-6', '评论', '月下读者', '《月亮宝石》那篇', '会做无剧透版本吗？', '会，关键转折都会避开，完整分析前也会醒目标注。', '可直接确认'],
  ['message-1', '私信', '新读者', '未关联内容', '能推荐一本适合我的推理吗？', '可以，先告诉我你更喜欢密室、人物心理，还是节奏快的短篇？', '需要追问'],
  ['message-2', '私信', '雨夜来信', '未关联内容', '想找一本不太吓人的。', '可以说说你更在意氛围、谜题还是人物吗？我会避开惊悚取向。', '需要追问'],
];

// The approved weekly calendar has exactly three pending and one conflict item.
// prettier-ignore
const planRows: readonly PlanRow[] = [
  ['mon-1','周一','7/27','10:00','密室诞生之前','《莫格街凶杀案》','已导出'],
  ['mon-2','周一','7/27','14:00','第一部现代侦探长篇','《月亮宝石》','已导出'],
  ['mon-3','周一','7/27','20:00','猎犬真的存在吗','《巴斯克维尔的猎犬》','已计划'],
  ['tue-1','周二','7/28','10:00','一头红发换来的圈套','《红发会》','已导出'],
  ['tue-2','周二','7/28','14:00','黄色房间为何无出口','《黄色房间的秘密》','已计划'],
  ['tue-3','周二','7/28','20:00','巴斯克维尔的诅咒传说','《巴斯克维尔的猎犬》','已计划'],
  ['wed-1','周三','7/29','10:00','侦探与医生的组合','《四签名》','已导出'],
  ['wed-2','周三','7/29','14:00','月亮宝石的离奇失窃','《月亮宝石》','已计划'],
  ['wed-3','周三','7/29','20:00','一封旧信里的四个签名','《四签名》','已计划'],
  ['thu-1','周四','7/30','10:00','反套路叙述者的魅力','《月亮宝石》','待审批'],
  ['thu-2','周四','7/30','14:00','谁在操纵红发会','《红发会》','已导出'],
  ['thu-3','周四','7/30','20:00','密室与不在场证明','《黄色房间的秘密》','已计划'],
  ['fri-1','周五','7/31','10:00','四签名案件的真相线','《四签名》','已导出'],
  ['fri-2','周五','7/31','14:00','猎犬追踪的科学依据','《巴斯克维尔的猎犬》','已计划'],
  ['fri-3','周五','7/31','20:00','红发会的幕后主谋','《红发会》','时间冲突'],
  ['sat-1','周六','8/1','10:00','柯南·道尔的创作日常','《巴斯克维尔的猎犬》','已导出'],
  ['sat-2','周六','8/1','14:00','月亮宝石的多重身份','《月亮宝石》','已导出'],
  ['sat-3','周六','8/1','20:00','黄色房间的空间逻辑','《黄色房间的秘密》','已计划'],
  ['sun-1','周日','8/2','10:00','最后的谜题与真相','《四签名》','已计划'],
  ['sun-2','周日','8/2','14:00','凶手如何布置密室','《莫格街凶杀案》','待审批'],
  ['sun-3','周日','8/2','20:00','侦探小说的冷幽默','《红发会》','待审批'],
];

function createFixture() {
  // The row-to-object projection is intentionally kept aligned for auditability.
  // prettier-ignore
  return {
    books: bookRows.map(([id, title, author, angle, posts, saves]) => ({ id, title, author, angle, posts, saves })),
    content: contentRows.map(([id, book, image, coverAlt, title, body, status, tags, time, materials]) => ({ id, book, cover: cover(image), coverAlt, title, body, status, tags, time, materials })),
    interactions: interactionRows.map(([id, type, author, source, original, suggestion, confidence]) => ({ id, type, author, source, original, suggestion, confidence, status: String('PENDING') })),
    metrics: ([['浏览', '12.8万', '+18%'], ['点赞', '8,640', '+12%'], ['收藏', '3,120', '+21%'], ['评论', '486', '+9%'], ['新增关注', '732', '+16%']] as const).map(([label, value, change]) => ({ label, value, change })),
    opportunities: ([['rain-room', '雨夜密室讨论升温', '《黄色房间的秘密》', '相关内容收藏增长明显，适合强化氛围与诡计拆解。'], ['public-domain', '公版侦探经典适合系列解读', '《莫格街凶杀案》', '长尾搜索稳定，可连续三篇建立专业判断。'], ['unreliable', '反套路叙述者收藏表现突出', '《月亮宝石》', '收藏率高于账号均值，适合做反套路短评。']] as const).map(([id, title, book, reason]) => ({ id, title, book, reason })),
    persona: { audience: '喜欢悬疑、推理与文化内容的普通读者', boundary: '不提前揭示关键凶手；完整诡计前给醒目剧透警告', name: '雾灯书页', tone: '理性、短句、观点鲜明、少量冷幽默' },
    plan: planRows.map(([id, day, date, time, title, book, status]) => ({ id, day, date, time, title, book, status })),
    recommendations: ([['locked-room', '增加密室主题', '密室相关内容收藏率比账号均值高 23%。', '下周增加 2 篇'], ['timing', '减少晚间重复排程', '周五 20:00 的两篇内容分散了互动。', '错开至少 90 分钟'], ['classics', '保留公版经典系列', '连续解读带来的关注转化更稳定。', '保持每周 3 篇']] as const).map(([id, title, reason, action]) => ({ id, title, reason, action, status: String('PENDING') })),
  };
}

export type V2Session = ReturnType<typeof createFixture>;
export type InteractionItem = V2Session['interactions'][number];

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

const fixture = deepFreeze(createFixture());
export const v2MockProvider = Object.freeze({
  fixtureIsFrozen: (): boolean => Object.isFrozen(fixture) && Object.isFrozen(fixture.plan),
  loadSession: (): V2Session => structuredClone(fixture),
  mode: 'DETERMINISTIC_MOCK' as const,
});
