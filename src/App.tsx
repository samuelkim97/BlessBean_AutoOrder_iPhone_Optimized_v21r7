import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

// BlessBean AutoOrder – iPhone 최적화 / Vercel 빌드 안정화 App.tsx
// ✅ 이 파일은 "전체 교체" 용도입니다. (부분 수정하다가 따옴표/중괄호 깨짐 재발 방지)
// ✅ Vercel 기준 빌드: `tsc -b && vite build` 통과 우선
// ✅ 메시지 문구는 배열 + join("\n") 방식(문자열 미종결 오류 재발 방지)
// ✅ 국가 코드는 ISO 3166-1 alpha-2 기반으로 매핑 (커피 산지 + 주요 국가)

// =====================
// 타입
// =====================
type PriceItem = {
  country: string;
  name: string;
  price: number;
  priceGroup: string;
};

type CartItem = {
  name: string;
  country: string;
  price: number;
  quantity: number;
  priceGroup: string;
};

type SalesPerson = "김대용" | "최운호" | "김용준" | "이신호" | "전진혁";
const SALESPEOPLE: SalesPerson[] = ["김대용", "최운호", "김용준", "이신호", "전진혁"];

type ClientHistoryItem = { name: string; lastUsedAt: number };

type OrderHistoryItem = {
  id: string;
  client: string;
  sender: SalesPerson;
  priceGroup: string;
  cart: CartItem[]; // quantity > 0 만 저장
  noteType: "account" | "card" | null;
  smallPack: boolean;
  sameDay: boolean;
  fileDate: string;
  createdAt: number;
};

// =====================
// 로컬스토리지 키
// =====================
const LS_KEY = "blessbean_priceList_v15_3";
const LS_SENDER_KEY = "blessbean_sender_v1";
const LS_MANUAL_KEY = "blessbean_manualPrices_v1";
const LS_CLIENT_HISTORY = "blessbean_clientHistory_v1";
const LS_ORDER_HISTORY = "blessbean_orderHistory_v1";

const ONE_MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_RECENT_CLIENTS = 8;
const MAX_RECENT_ORDERS = 8;
const UNDO_MS = 5000;

// =====================
// 국가명 → ISO 3166-1 alpha-2 매핑
// - 커피 산지 + 주요 국가 우선 수록
// - 엑셀에 들어올 수 있는 표기(한글/영문/공백/괄호코드 등)를 넉넉히 흡수
// =====================
const COUNTRY_ALIAS_TO_ISO2: Record<string, string> = {
  // 스페셜 태그 (ISO 아님)
  디카페인: "[디카페인]",
  Decaf: "[디카페인]",
  DECAF: "[디카페인]",

  // ---------- 커피 주요 산지 ----------
  브라질: "BR",
  Brazil: "BR",
  BRASIL: "BR",

  콜롬비아: "CO",
  Colombia: "CO",

  페루: "PE",
  Peru: "PE",

  에콰도르: "EC",
  Ecuador: "EC",

  볼리비아: "BO",
  Bolivia: "BO",

  과테말라: "GT",
  Guatemala: "GT",

  엘살바도르: "SV",
  "엘 살바도르": "SV",
  "El Salvador": "SV",

  온두라스: "HN",
  Honduras: "HN",

  니카라과: "NI",
  Nicaragua: "NI",

  코스타리카: "CR",
  "코스타 리카": "CR",
  "Costa Rica": "CR",

  파나마: "PA",
  Panama: "PA",

  멕시코: "MX",
  Mexico: "MX",

  자메이카: "JM",
  Jamaica: "JM",

  쿠바: "CU",
  Cuba: "CU",

  도미니카공화국: "DO",
  도미니카: "DO",
  "Dominican Republic": "DO",

  아이티: "HT",
  Haiti: "HT",

  에티오피아: "ET",
  Ethiopia: "ET",

  케냐: "KE",
  Kenya: "KE",

  르완다: "RW",
  Rwanda: "RW",

  우간다: "UG",
  Uganda: "UG",

  부룬디: "BI",
  Burundi: "BI",

  탄자니아: "TZ", // ✅ Tanzania = TZ (TN은 튀니지)
  Tanzania: "TZ",

  말라위: "MW",
  Malawi: "MW",

  잠비아: "ZM",
  Zambia: "ZM",

  짐바브웨: "ZW",
  Zimbabwe: "ZW",

  마다가스카르: "MG",
  Madagascar: "MG",

  콩고민주공화국: "CD",
  "콩고 민주 공화국": "CD",
  "DR Congo": "CD",
  "Democratic Republic of the Congo": "CD",

  콩고: "CG",
  Congo: "CG",
  "Republic of the Congo": "CG",

  카메룬: "CM",
  Cameroon: "CM",

  가나: "GH",
  Ghana: "GH",

  나이지리아: "NG",
  Nigeria: "NG",

  코트디부아르: "CI",
  "코트 디부아르": "CI",
  "Cote d'Ivoire": "CI",
  "Côte d'Ivoire": "CI",
  "Ivory Coast": "CI",

  예멘: "YE",
  예맨: "YE", // ✅ 요청 반영 (오타/표기 변형 대응)
  Yemen: "YE",

  인도네시아: "ID",
  "인도 네시아": "ID",
  Indonesia: "ID",

  베트남: "VN",
  Vietnam: "VN",

  인도: "IN",
  India: "IN",

  네팔: "NP",
  Nepal: "NP",

  스리랑카: "LK",
  "Sri Lanka": "LK",

  파푸아뉴기니: "PG",
  "파푸아 뉴기니": "PG",
  "Papua New Guinea": "PG",

  동티모르: "TL",
  "Timor-Leste": "TL",
  "East Timor": "TL",

  라오스: "LA",
  Laos: "LA",

  캄보디아: "KH",
  Cambodia: "KH",

  미얀마: "MM",
  Myanmar: "MM",

  태국: "TH",
  Thailand: "TH",

  필리핀: "PH",
  Philippines: "PH",

  중국: "CN",
  China: "CN",

  // ---------- 주요 국가(유명 국가/거래처 문구에 등장 가능) ----------
  대한민국: "KR",
  한국: "KR",
  "South Korea": "KR",
  북한: "KP",
  "North Korea": "KP",

  일본: "JP",
  Japan: "JP",

  미국: "US",
  "United States": "US",
  USA: "US",
  하와이: "US",

  캐나다: "CA",
  Canada: "CA",

  영국: "GB",
  "United Kingdom": "GB",
  UK: "GB",

  프랑스: "FR",
  France: "FR",

  독일: "DE",
  Germany: "DE",

  이탈리아: "IT",
  Italy: "IT",

  스페인: "ES",
  Spain: "ES",

  포르투갈: "PT",
  Portugal: "PT",

  네덜란드: "NL",
  Netherlands: "NL",
  Holland: "NL",

  벨기에: "BE",
  Belgium: "BE",

  스위스: "CH",
  Switzerland: "CH",

  오스트리아: "AT",
  Austria: "AT",

  스웨덴: "SE",
  Sweden: "SE",

  노르웨이: "NO",
  Norway: "NO",

  덴마크: "DK",
  Denmark: "DK",

  핀란드: "FI",
  Finland: "FI",

  아일랜드: "IE",
  Ireland: "IE",

  폴란드: "PL",
  Poland: "PL",

  체코: "CZ",
  Czechia: "CZ",
  "Czech Republic": "CZ",

  호주: "AU",
  Australia: "AU",

  뉴질랜드: "NZ",
  "New Zealand": "NZ",

  터키: "TR",
  Turkey: "TR",

  러시아: "RU",
  Russia: "RU",

  우크라이나: "UA",
  Ukraine: "UA",

  사우디아라비아: "SA",
  "Saudi Arabia": "SA",

  아랍에미리트: "AE",
  UAE: "AE",
  "United Arab Emirates": "AE",

  카타르: "QA",
  Qatar: "QA",

  쿠웨이트: "KW",
  Kuwait: "KW",

  오만: "OM",
  Oman: "OM",

  이란: "IR",
  Iran: "IR",

  이라크: "IQ",
  Iraq: "IQ",

  이스라엘: "IL",
  Israel: "IL",

  요르단: "JO",
  Jordan: "JO",

  레바논: "LB",
  Lebanon: "LB",

  이집트: "EG",
  Egypt: "EG",

  모로코: "MA",
  Morocco: "MA",

  알제리: "DZ",
  Algeria: "DZ",

  튀니지: "TN",
  Tunisia: "TN",

  남아프리카공화국: "ZA",
  "South Africa": "ZA",

  아르헨티나: "AR",
  Argentina: "AR",

  칠레: "CL",
  Chile: "CL",

  우루과이: "UY",
  Uruguay: "UY",

  파라과이: "PY",
  Paraguay: "PY",

  베네수엘라: "VE",
  Venezuela: "VE",

  말레이시아: "MY",
  Malaysia: "MY",

  싱가포르: "SG",
  Singapore: "SG",

  대만: "TW",
  Taiwan: "TW",

  홍콩: "HK",
  "Hong Kong": "HK",

  브루나이: "BN",
  Brunei: "BN",
};

// =====================
// 유틸
// =====================
function normalizeCountry(raw: unknown): string {
  let s = (raw ?? "")
    .toString()
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .trim();

  if (!s) return "";

  // "브라질(BR)" → BR
  const paren = s.match(/\(([A-Za-z]{2})\)/);
  if (paren?.[1]) return paren[1].toUpperCase();

  // "에 티 오 피 아"처럼 1글자씩 분리된 케이스 → 합치기
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => t.length === 1)) {
    s = tokens.join("");
  }

  const mapped = COUNTRY_ALIAS_TO_ISO2[s];
  if (mapped) return mapped;

  // 2글자 코드면 그대로 사용
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();

  return s;
}

const makePriceKey = (group: string, country: string, name: string) =>
  `${group}__${country}__${name}`;

function parsePriceToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const cleaned = String(value).replace(/[^\d]/g, "");
  if (!cleaned) return null;

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

// Optional self-tests (배포 안전)
// URL에 `?bb_selftest=1` 붙이면 브라우저에서만 실행
function runSelfTests() {
  if (normalizeCountry("예멘") !== "YE") throw new Error("SelfTest: 예멘");
  if (normalizeCountry("예맨") !== "YE") throw new Error("SelfTest: 예맨");
  if (normalizeCountry("탄자니아") !== "TZ") throw new Error("SelfTest: 탄자니아");
  if (normalizeCountry("브라질(BR)") !== "BR") throw new Error("SelfTest: 괄호코드");
  if (normalizeCountry("br") !== "BR") throw new Error("SelfTest: code upper");
}

try {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("bb_selftest") === "1") runSelfTests();
  }
} catch {
  // ignore
}

// =====================
// App
// =====================
export default function App() {
  const [step, setStep] = useState(1);
  const [client, setClient] = useState("");
  const [priceGroup, setPriceGroup] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteType, setNoteType] = useState<"account" | "card" | null>(null);
  const [smallPack, setSmallPack] = useState(false);
  const [sameDay, setSameDay] = useState(false);

  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [toastMode, setToastMode] = useState<"normal" | "undo">("normal");

  const [itemsAll, setItemsAll] = useState<PriceItem[]>([]);
  const [fileDate, setFileDate] = useState("");
  const [sender, setSender] = useState<SalesPerson>("김용준");

  const [clientHistory, setClientHistory] = useState<ClientHistoryItem[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryItem[]>([]);

  const [manualPrices, setManualPrices] = useState<Record<string, number>>({});
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const priceInputRef = useRef<HTMLInputElement | null>(null);

  const [undo, setUndo] = useState<{ item: CartItem; index: number; expiresAt: number } | null>(
    null
  );

  // iPhone 터치/텍스트 확대 제어
  useEffect(() => {
    document.body.style.touchAction = "manipulation";
    (document.body.style as any).webkitTextSizeAdjust = "100%";
  }, []);

  // 초기 로드
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.savedAt && Date.now() - parsed.savedAt < ONE_MONTH_MS) {
          setItemsAll(parsed.itemsAll || []);
          setFileDate(parsed.fileDate || "");
          setStep(2);

          // manualPrices는 fileDate가 같을 때만 복원
          const manualSaved = localStorage.getItem(LS_MANUAL_KEY);
          if (manualSaved) {
            const mp = JSON.parse(manualSaved);
            if (mp?.fileDate && mp.fileDate === (parsed.fileDate || "")) {
              setManualPrices(mp.manualPrices || {});
            }
          }
        }
      }

      const savedSender = localStorage.getItem(LS_SENDER_KEY);
      if (savedSender && (SALESPEOPLE as readonly string[]).includes(savedSender)) {
        setSender(savedSender as SalesPerson);
      }

      const ch = localStorage.getItem(LS_CLIENT_HISTORY);
      if (ch) {
        const parsed = JSON.parse(ch);
        if (Array.isArray(parsed)) setClientHistory(parsed);
      }

      const oh = localStorage.getItem(LS_ORDER_HISTORY);
      if (oh) {
        const parsed = JSON.parse(oh);
        if (Array.isArray(parsed)) setOrderHistory(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  // sender 저장
  useEffect(() => {
    try {
      localStorage.setItem(LS_SENDER_KEY, sender);
    } catch {
      // ignore
    }
  }, [sender]);

  // 수동단가 저장
  useEffect(() => {
    if (!fileDate) return;
    try {
      localStorage.setItem(
        LS_MANUAL_KEY,
        JSON.stringify({ fileDate, manualPrices, savedAt: Date.now() })
      );
    } catch {
      // ignore
    }
  }, [manualPrices, fileDate]);

  // 최근 기록 저장
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_CLIENT_HISTORY,
        JSON.stringify(clientHistory.slice(0, MAX_RECENT_CLIENTS))
      );
    } catch {
      // ignore
    }
  }, [clientHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_ORDER_HISTORY,
        JSON.stringify(orderHistory.slice(0, MAX_RECENT_ORDERS))
      );
    } catch {
      // ignore
    }
  }, [orderHistory]);

  // 토스트 자동 숨김
  useEffect(() => {
    if (!toast) return;
    const duration = toastMode === "undo" ? UNDO_MS : 1200;
    const t = setTimeout(() => {
      setToast("");
      if (toastMode === "undo") setUndo(null);
      setToastMode("normal");
    }, duration);
    return () => clearTimeout(t);
  }, [toast, toastMode]);

  // 단가 인라인 입력 포커스
  useEffect(() => {
    if (!editingPriceKey) return;
    const t = setTimeout(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [editingPriceKey]);

  // 국가/품목 목록
  const countries = useMemo(() => {
    const list = Array.from(
      new Set(itemsAll.filter((i) => i.priceGroup === priceGroup).map((i) => i.country))
    );
    return list.sort((a, b) => a.localeCompare(b));
  }, [itemsAll, priceGroup]);

  const items = useMemo(
    () => itemsAll.filter((i) => i.country === selectedCountry && i.priceGroup === priceGroup),
    [itemsAll, selectedCountry, priceGroup]
  );

  // 최근 주문: 거래처 입력 시 해당 거래처만 필터(완전 일치)
  const filteredOrderHistory = useMemo(() => {
    const key = client.trim();
    if (!key) return orderHistory;
    return orderHistory.filter((o) => o.client === key);
  }, [orderHistory, client]);

  // 메시지 생성 (안전: join 방식)
  useEffect(() => {
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const orderLines = cart
      .filter((i) => i.quantity > 0)
      .map((i) => `${i.country} ${i.name} ${i.quantity}kg * ${i.price.toLocaleString()}원`);

    // 항상 들어갈 공지(요청 반영)
    const extraNoticeLines = ["* 14시 전 입금시 당일출고", "* 입금 확인문자 부탁드립니다"];

    // 결제 타입별 문구 (중복 방지: 확인문구는 extraNotice로 항상 들어감)
    const noteLines: string[] =
      noteType === "account"
        ? ["계좌번호 1006-901-483313 우리은행 블레스빈"]
        : noteType === "card"
        ? ["카드 결제 링크 요청 드립니다."]
        : [];

    const footerLines: string[] = [`총 금액 ${total.toLocaleString()}원`];
    if (smallPack) footerLines.push("*5kg 소분 출고 요청");
    if (sameDay) footerLines.push("*금일 출고 요청");
    footerLines.push("");
    footerLines.push(...extraNoticeLines);
    if (noteLines.length) footerLines.push("", ...noteLines);

    const msgLines: string[] = [
      "안녕하세요.",
      "바른생각",
      "다른커피",
      `블레스빈 ${sender}입니다.`,
      "요청하신 단가 안내드립니다.",
      "",
      client,
      "",
      ...orderLines,
      "",
      ...footerLines,
    ];

    setMessage(msgLines.join("\n"));
  }, [cart, noteType, client, sender, smallPack, sameDay]);

  // 최근 거래처 저장
  const pushRecentClient = useCallback((nameRaw: string) => {
    const name = (nameRaw ?? "").trim();
    if (!name) return;

    const now = Date.now();
    setClientHistory((prev) => {
      const next = [{ name, lastUsedAt: now }, ...prev.filter((x) => x.name !== name)];
      return next.slice(0, MAX_RECENT_CLIENTS);
    });
  }, []);

  // 최근 주문 저장
  const pushRecentOrder = useCallback(() => {
    const clientName = client.trim();
    if (!clientName) return;

    const cartLines = cart.filter((i) => i.quantity > 0);
    if (cartLines.length === 0) return;

    const now = Date.now();
    const order: OrderHistoryItem = {
      id: String(now),
      client: clientName,
      sender,
      priceGroup: priceGroup || "",
      cart: cartLines.map((x) => ({ ...x })),
      noteType,
      smallPack,
      sameDay,
      fileDate,
      createdAt: now,
    };

    setOrderHistory((prev) => [order, ...prev].slice(0, MAX_RECENT_ORDERS));
  }, [client, cart, sender, priceGroup, noteType, smallPack, sameDay, fileDate]);

  // 최근 주문 불러오기
  const loadRecentOrder = useCallback((o: OrderHistoryItem) => {
    setClient(o.client);
    setSender(o.sender);
    setPriceGroup(o.priceGroup || "");
    setCart(o.cart || []);
    setNoteType(o.noteType ?? null);
    setSmallPack(!!o.smallPack);
    setSameDay(!!o.sameDay);
    setSelectedCountry(null);
    setStep(o.priceGroup ? 4 : 3);
    setToastMode("normal");
    setToast("최근 주문 불러오기 완료!");
  }, []);

  const deleteRecentOrder = useCallback((id: string) => {
    setOrderHistory((prev) => prev.filter((o) => o.id !== id));
    setToastMode("normal");
    setToast("주문 이력이 삭제되었습니다.");
  }, []);

  // 엑셀 업로드
  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    const collected: PriceItem[] = [];

    for (const sheetName of wb.SheetNames) {
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
        header: 1,
        defval: "",
      });

      let headerRow = -1;
      let nameIdx = -1;
      let priceIdx = -1;
      let countryIdx = 1; // 기본 B열

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const hasNameHeader = row.some(
          (c) => typeof c === "string" && /(품명|제품명)/.test(c)
        );
        const hasPriceHeader = row.some(
          (c) => typeof c === "string" && /(단가|가격)/.test(c)
        );

        if (hasNameHeader && hasPriceHeader) {
          headerRow = i;
          nameIdx = row.findIndex((c) => typeof c === "string" && /(품명|제품명)/.test(c));
          priceIdx = row.findIndex((c) => typeof c === "string" && /(단가|가격)/.test(c));

          // 국가/원산지 컬럼이 있으면 그걸 우선 사용(없으면 B열 유지)
          const foundCountryIdx = row.findIndex(
            (c) => typeof c === "string" && /(국가|원산지|Country)/i.test(c)
          );
          if (foundCountryIdx >= 0) countryIdx = foundCountryIdx;

          break;
        }
      }

      if (headerRow < 0 || nameIdx < 0 || priceIdx < 0) continue;

      let currentCountry = "";
      for (let r = headerRow + 1; r < rows.length; r++) {
        const row = rows[r];

        const maybeCountry = normalizeCountry(row[countryIdx]);
        if (maybeCountry) currentCountry = maybeCountry;

        const rawName = row[nameIdx];
        const rawPrice = row[priceIdx];

        const name =
          typeof rawName === "string" ? rawName.trim() : String(rawName ?? "").trim();
        if (!name || !currentCountry) continue;

        const priceNum = parsePriceToNumber(rawPrice);
        if (priceNum === null) continue;

        collected.push({
          country: currentCountry,
          name,
          price: priceNum,
          priceGroup: sheetName,
        });
      }
    }

    const match = file.name.match(/(20\d{2})(\d{2})/);
    const label = match ? `${match[1]}년 ${match[2]}월 단가표` : file.name;

    setFileDate(label);
    setItemsAll(collected);

    // 새 단가표면 수동단가 초기화
    setManualPrices({});
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ savedAt: Date.now(), itemsAll: collected, fileDate: label })
      );
      localStorage.setItem(
        LS_MANUAL_KEY,
        JSON.stringify({ fileDate: label, manualPrices: {}, savedAt: Date.now() })
      );
    } catch {
      // ignore
    }

    setStep(2);
    setToastMode("normal");
    setToast("단가표 로드 완료!");
    e.currentTarget.value = "";
  }, []);

  // 장바구니 추가
  const addToCart = useCallback(
    (item: PriceItem) => {
      const key = makePriceKey(item.priceGroup, item.country, item.name);
      const priceToUse = manualPrices[key] ?? item.price;

      setCart((prev) => {
        const exists = prev.some(
          (x) =>
            x.name === item.name && x.country === item.country && x.priceGroup === item.priceGroup
        );
        if (exists) return prev;

        return [
          ...prev,
          {
            name: item.name,
            country: item.country,
            price: priceToUse,
            quantity: 0,
            priceGroup: item.priceGroup,
          },
        ];
      });
    },
    [manualPrices]
  );

  // 수량 조절
  const updateQty = useCallback((n: string, c: string, g: string, delta: number) => {
    setCart((prev) =>
      prev.map((x) =>
        x.name === n && x.country === c && x.priceGroup === g
          ? { ...x, quantity: Math.max(x.quantity + delta, 0) }
          : x
      )
    );
  }, []);

  const setQtyExact = useCallback((n: string, c: string, g: string, qty: number) => {
    const safe = Number.isFinite(qty) ? qty : 0;
    setCart((prev) =>
      prev.map((x) =>
        x.name === n && x.country === c && x.priceGroup === g
          ? { ...x, quantity: Math.max(safe, 0) }
          : x
      )
    );
  }, []);

  const removeFromCart = useCallback((n: string, c: string, g: string) => {
    setCart((prev) => prev.filter((x) => !(x.name === n && x.country === c && x.priceGroup === g)));
  }, []);

  // 삭제 Undo
  const removeCartItemWithUndo = useCallback((target: CartItem, index: number) => {
    setCart((prev) =>
      prev.filter(
        (x) =>
          !(
            x.name === target.name &&
            x.country === target.country &&
            x.priceGroup === target.priceGroup
          )
      )
    );

    setUndo({ item: target, index, expiresAt: Date.now() + UNDO_MS });
    setToastMode("undo");
    setToast("삭제됨");
  }, []);

  const undoRemove = useCallback(() => {
    if (!undo) return;

    if (Date.now() > undo.expiresAt) {
      setUndo(null);
      setToastMode("normal");
      setToast("되돌리기 시간이 지났습니다.");
      return;
    }

    setCart((prev) => {
      const exists = prev.some(
        (x) =>
          x.name === undo.item.name &&
          x.country === undo.item.country &&
          x.priceGroup === undo.item.priceGroup
      );
      if (exists) return prev;

      const next = [...prev];
      const idx = Math.min(Math.max(undo.index, 0), next.length);
      next.splice(idx, 0, undo.item);
      return next;
    });

    setUndo(null);
    setToastMode("normal");
    setToast("복구 완료!");
  }, [undo]);

  // 단가 수동 수정
  const editPrice = (target: CartItem) => {
    const key = makePriceKey(target.priceGroup, target.country, target.name);
    setEditingPriceKey(key);
    setPriceInput(String(target.price));
  };

  const applyPriceEdit = (target: CartItem) => {
    const cleaned = (priceInput ?? "").trim().replace(/[^0-9]/g, "");
    if (!cleaned) {
      setToastMode("normal");
      setToast("숫자로 단가를 입력해주세요.");
      return;
    }

    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) {
      setToastMode("normal");
      setToast("올바른 숫자를 입력해주세요.");
      return;
    }

    setCart((prev) =>
      prev.map((x) =>
        x.name === target.name && x.country === target.country && x.priceGroup === target.priceGroup
          ? { ...x, price: numeric }
          : x
      )
    );

    const key = makePriceKey(target.priceGroup, target.country, target.name);
    setManualPrices((prev) => ({ ...prev, [key]: numeric }));

    setEditingPriceKey(null);
    setToastMode("normal");
    setToast("단가가 수정되었습니다.");
  };

  const cancelPriceEdit = () => {
    setEditingPriceKey(null);
    setPriceInput("");
    setToastMode("normal");
    setToast("단가 변경이 취소되었습니다.");
  };

  // 복사 (iOS 대응)
  const copyToClipboard = async () => {
    if (!message) {
      setToastMode("normal");
      setToast("복사할 문구가 없습니다.");
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
      setToastMode("normal");
      setToast("문구 복사 완료!");
      pushRecentClient(client);
      pushRecentOrder();
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);

      setToastMode("normal");
      setToast("문구 복사 완료!");
      pushRecentClient(client);
      pushRecentOrder();
    }
  };

  // 거래처 입력 단계로 리셋
  const backToClient = () => {
    setStep(2);
    setClient("");
    setCart([]);
    setSelectedCountry(null);
    setNoteType(null);
    setSmallPack(false);
    setSameDay(false);
    setUndo(null);
    setToastMode("normal");
    setToast("초기화 완료");
  };

  // =====================
  // UI
  // =====================
  return (
    <div className="flex flex-col min-h-screen bg-white text-lg">
      <header className="sticky top-0 z-50 bg-white border-b border-red-200 p-3 text-center font-bold text-red-700 text-xl">
        ☕ BlessBean AutoOrder
        {fileDate && <p className="text-sm text-gray-600 mt-1">📅 {fileDate}</p>}
      </header>

      <main className="flex-1 px-3 pb-28">
        {step === 1 && (
          <div className="mt-5 text-center text-gray-500">
            📂 오른쪽 아래 버튼으로 엑셀을 업로드하세요.
          </div>
        )}

        {/* STEP 2: 거래처 + 담당자 */}
        {step === 2 && (
          <div className="mt-5 space-y-3">
            <p className="text-center text-red-700 font-semibold">2️⃣ 거래처명 입력</p>

            <input
              value={client}
              onChange={(e) => setClient(e.target.value)}
              placeholder="거래처명 입력"
              className="w-full text-center py-3 border border-red-300 rounded-md text-red-700 text-lg outline-none"
            />

            {clientHistory.length > 0 && (
              <div className="mt-1">
                <p className="text-center text-gray-600 font-semibold text-sm">최근 거래처</p>
                <div className="flex flex-wrap gap-2 justify-center mt-2">
                  {clientHistory.slice(0, MAX_RECENT_CLIENTS).map((x) => (
                    <button
                      key={x.name}
                      type="button"
                      onClick={() => {
                        setClient(x.name);
                        setToastMode("normal");
                        setToast("거래처 선택됨");
                      }}
                      className="px-3 py-2 rounded-full border border-gray-300 bg-gray-50 text-gray-700 text-sm active:scale-95"
                      title={x.name}
                    >
                      {x.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-center text-red-700 font-semibold mt-2">담당자 선택</p>
            <div className="grid grid-cols-5 gap-2">
              {SALESPEOPLE.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSender(name)}
                  className={`py-2 rounded-md border text-sm ${
                    sender === name
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>

            {filteredOrderHistory.length > 0 && (
              <div className="mt-2">
                <p className="text-center text-gray-600 font-semibold text-sm">
                  최근 주문 (불러오기)
                </p>

                <div className="mt-2 space-y-2">
                  {filteredOrderHistory.slice(0, 5).map((o) => {
                    const totalKg = o.cart.reduce((s, x) => s + (x.quantity || 0), 0);
                    const itemCount = o.cart.length;

                    const timeText = new Date(o.createdAt).toLocaleString("ko-KR", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    });

                    const preview =
                      itemCount === 0
                        ? "품목 없음"
                        : itemCount === 1
                        ? `${o.cart[0].country} ${o.cart[0].name}`
                        : `${o.cart[0].country} ${o.cart[0].name} 외 ${itemCount - 1}개`;

                    const fileHint =
                      o.fileDate && fileDate && o.fileDate !== fileDate ? " (단가표 다름)" : "";

                    return (
                      <div
                        key={o.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => loadRecentOrder(o)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") loadRecentOrder(o);
                        }}
                        className="w-full text-left border border-gray-200 rounded-md p-3 bg-white active:scale-[0.99] cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-800">{o.client}</span>
                          <span className="text-xs text-gray-500">{timeText}</span>
                        </div>

                        <div className="flex justify-end mt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteRecentOrder(o.id);
                            }}
                            className="text-xs text-red-600 border border-red-300 rounded-md px-2 py-1 active:scale-95"
                          >
                            지우기
                          </button>
                        </div>

                        <div className="text-xs text-gray-600 mt-1">
                          {preview} · {totalKg}kg · 그룹 {o.priceGroup || "-"} · {o.sender}
                          {fileHint}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              disabled={!client}
              type="button"
              onClick={() => setStep(3)}
              className={`w-full py-3 rounded-md text-lg ${
                client ? "bg-red-600 text-white" : "bg-red-200 text-white"
              }`}
            >
              다음
            </button>
          </div>
        )}

        {/* STEP 3: 그룹 선택 */}
        {step === 3 && (
          <div className="mt-5 space-y-3">
            <p className="text-center text-red-700 font-semibold">3️⃣ 단가 그룹 선택</p>
            <div className="grid grid-cols-2 gap-3">
              {["(1)", "(2)", "(3)", "(4)"].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setPriceGroup(g);
                    setSelectedCountry(null);
                    setStep(4);
                  }}
                  className="py-4 bg-red-100 border border-red-300 text-red-800 text-xl rounded-md"
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* STEP 4: 국가/품목 */}
        {step === 4 && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-5 gap-2">
              {countries.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedCountry(c)}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    selectedCountry === c
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {selectedCountry && (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {items.map((i) => {
                  const key = makePriceKey(i.priceGroup, i.country, i.name);
                  const displayPrice = manualPrices[key] ?? i.price;

                  return (
                    <div
                      key={`${i.priceGroup}-${i.country}-${i.name}`}
                      className="flex items-center gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => addToCart(i)}
                        className="flex-1 justify-between bg-red-50 text-red-800 border border-red-300 px-4 py-3 rounded-md active:scale-95 flex items-center"
                      >
                        <span
                          className="flex-1 pr-3 text-sm leading-snug"
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                          }}
                          title={i.name}
                        >
                          {i.name}
                        </span>
                        <span className="text-base whitespace-nowrap">
                          {displayPrice.toLocaleString()}원
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => removeFromCart(i.name, i.country, i.priceGroup)}
                        className="px-3 py-3 rounded-md border border-red-300 text-red-700"
                        title="장바구니에서 삭제"
                      >
                        ❌
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 장바구니 */}
        {cart.length > 0 && (
          <div className="mt-6 mb-28">
            <p className="font-semibold text-red-700 flex items-center justify-between mb-2">
              🧺 장바구니
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setNoteType(noteType === "account" ? null : "account")}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    noteType === "account"
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  [계좌번호]
                </button>

                <button
                  type="button"
                  onClick={() => setNoteType(noteType === "card" ? null : "card")}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    noteType === "card"
                      ? "bg-yellow-500 text-white border-yellow-500"
                      : "bg-yellow-100 text-yellow-800 border-yellow-300"
                  }`}
                >
                  [카드결제]
                </button>

                <button
                  type="button"
                  onClick={() => setSmallPack(!smallPack)}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    smallPack
                      ? "bg-green-600 text-white border-green-600"
                      : "bg-green-100 text-green-800 border-green-300"
                  }`}
                >
                  5kg 소분
                </button>

                <button
                  type="button"
                  onClick={() => setSameDay(!sameDay)}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    sameDay
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-blue-100 text-blue-800 border-blue-300"
                  }`}
                >
                  금일
                </button>
              </span>
            </p>

            {cart.map((i, idx) => {
              const key = makePriceKey(i.priceGroup, i.country, i.name);
              const isEditing = editingPriceKey === key;

              const preview = (() => {
                const cleaned = priceInput.trim().replace(/[^0-9]/g, "");
                if (!isEditing || !cleaned) return "";
                const num = Number(cleaned);
                if (!Number.isFinite(num)) return "";
                return `${num.toLocaleString()}원`;
              })();

              return (
                <div
                  key={`${i.priceGroup}-${i.country}-${i.name}`}
                  className="bg-red-50 border border-red-200 rounded-lg p-3 mb-2"
                >
                  <p className="text-base text-red-800 break-words leading-snug">
                    {i.country} {i.name} {i.quantity}kg * {i.price.toLocaleString()}원
                  </p>

                  <div className="flex justify-between items-center mt-2">
                    <div className="flex gap-2 flex-wrap">
                      {[1, 5, 20].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => updateQty(i.name, i.country, i.priceGroup, v)}
                          className="bg-red-200 text-red-800 text-sm px-4 py-2 rounded-md active:scale-95"
                        >
                          +{v}
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => updateQty(i.name, i.country, i.priceGroup, -i.quantity)}
                        className="bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded-md"
                      >
                        0kg
                      </button>

                      <button
                        type="button"
                        onClick={() => editPrice(i)}
                        className="bg-white border border-red-300 text-red-700 text-sm px-3 py-2 rounded-md active:scale-95"
                      >
                        단가
                      </button>

                      <button
                        type="button"
                        onClick={() => removeCartItemWithUndo(i, idx)}
                        className="bg-red-600 text-white text-sm px-4 py-2 rounded-md active:scale-95"
                      >
                        삭제
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      <input
                        value={String(i.quantity)}
                        onChange={(e) => {
                          const cleaned = e.target.value.replace(/[^0-9]/g, "");
                          const num = cleaned ? Number(cleaned) : 0;
                          if (!Number.isFinite(num)) return;
                          setQtyExact(i.name, i.country, i.priceGroup, num);
                        }}
                        onFocus={(e) => e.currentTarget.select()}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="w-16 text-right border border-red-300 rounded-md px-2 py-1 text-[16px] bg-white"
                        aria-label="수량(kg) 직접 입력"
                      />
                      <span className="text-red-700 font-semibold text-sm">kg</span>
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-red-700">단가 수정</span>

                      <input
                        ref={priceInputRef}
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value.replace(/[^0-9]/g, ""))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") applyPriceEdit(i);
                          if (e.key === "Escape") cancelPriceEdit();
                        }}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="w-32 text-right border border-red-300 rounded-md px-2 py-1 text-[16px]"
                        placeholder="숫자만 입력"
                      />

                      <button
                        type="button"
                        onClick={() => applyPriceEdit(i)}
                        className="bg-red-600 text-white text-xs px-3 py-1 rounded-md active:scale-95"
                      >
                        확인
                      </button>

                      <button
                        type="button"
                        onClick={cancelPriceEdit}
                        className="bg-gray-200 text-gray-700 text-xs px-3 py-1 rounded-md active:scale-95"
                      >
                        취소
                      </button>

                      {preview && <span className="text-xs text-gray-600">{preview}</span>}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="bg-red-50 border border-red-200 p-4 whitespace-pre-wrap text-sm text-red-800 mt-3 rounded-md">
              {message}
            </div>
          </div>
        )}
      </main>

      <footer
        className="fixed bottom-4 left-4 right-4 z-50 pointer-events-none flex justify-between items-end"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={backToClient}
            className="bg-white border border-blue-300 text-blue-700 text-base rounded-full px-4 h-12 shadow-md active:scale-95"
          >
            📋 거래처 입력
          </button>
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-3">
          <label
            className="bg-white border border-red-300 rounded-full p-3 shadow-md cursor-pointer hover:bg-red-50 active:scale-95"
            aria-label="엑셀 업로드"
          >
            📂
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>

          {cart.length > 0 && (
            <button
              type="button"
              onClick={copyToClipboard}
              className="bg-red-600 text-white text-xl rounded-full w-20 h-20 shadow-lg active:scale-95"
            >
              복사
            </button>
          )}
        </div>
      </footer>

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-md shadow-md flex items-center gap-3"
          style={{ bottom: "calc(6rem + env(safe-area-inset-bottom))" }}
        >
          <span>{toast}</span>
          {toastMode === "undo" && undo && (
            <button
              type="button"
              onClick={undoRemove}
              className="underline font-semibold"
              aria-label="삭제 되돌리기"
            >
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
