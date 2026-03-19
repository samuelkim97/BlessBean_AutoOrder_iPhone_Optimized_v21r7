import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

// BlessBean AutoOrder – iPhone 최적화 버전 App.tsx
// - 담당자 선택 (김대용 / 최운호 / 김용준 / 이신호)
// - 인사말 커스터마이즈
// - (1)~(4) 단가 그룹 + 품목별 단가 수동 수정 (인라인 편집)
// - 5kg 소분 옵션 토글 + 금일 출고 요청 토글
// - 배송비 옵션 토글 (3,500원)
// - 긴 품목명(iPhone) 최대 2줄 표시
// - 수동 단가 manualPrices 로컬 저장(단가표(fileDate) 기준으로 복원)
//
// [추가 적용]
// - 수량(kg) 직접 입력
// - 최근 거래처/최근 주문 불러오기(로컬 저장)
// - iOS 입력 줌 방지(입력 16px)
// - Safe Area 대응(footer/토스트)
// - 삭제 Undo(되돌리기)
// - 최근 주문: 거래처 입력 시 해당 거래처만 필터링 + 개별 삭제(지우기)
// - 최근 주문 불러오기 시 현재 단가표 기준으로 가격 재매칭
// - 단가 그룹 (1)~(4) 섞임 방지

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
  cart: CartItem[];
  noteType: "account" | "card" | null;
  smallPack: boolean;
  sameDay: boolean;
  deliveryFee: boolean;
  fileDate: string;
  createdAt: number;
};

const LS_KEY = "blessbean_priceList_v15_3";
const LS_SENDER_KEY = "blessbean_sender_v1";
const LS_MANUAL_KEY = "blessbean_manualPrices_v1";
const LS_CLIENT_HISTORY = "blessbean_clientHistory_v1";
const LS_ORDER_HISTORY = "blessbean_orderHistory_v1";

const ONE_MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_RECENT_CLIENTS = 8;
const MAX_RECENT_ORDERS = 8;
const UNDO_MS = 5000;
const DELIVERY_FEE = 3500;

const COUNTRY_ISO_MAP: Record<string, string> = {
  브라질: "BR",
  콜롬비아: "CO",
  에티오피아: "ET",
  과테말라: "GT",
  인도네시아: "ID",
  인도: "IN",
  케냐: "KE",
  엘살바도르: "SV",
  온두라스: "HN",
  자메이카: "JM",
  탄자니아: "TN",
  디카페인: "[디카페인]",
  베트남: "VN",
  코스타리카: "CR",
  니카라과: "NI",
  멕시코: "MX",
  페루: "PE",
  파푸아뉴기니: "PG",
  예멘: "YE",
  예맨: "YE",
  Yemen: "YE",
  르완다: "RW",
  우간다: "UG",
  파나마: "PA",
  하와이: "US",
};

function normalizeCountry(raw: string): string {
  let s = (raw ?? "")
    .toString()
    .normalize("NFC")
    .replace(/\u00A0/g, " ")
    .replace(/[()\[\]{}]/g, " ")
    .trim();

  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => t.length === 1)) s = tokens.join("");

  const compact = s.replace(/\s+/g, "");
  const upperCompact = compact.toUpperCase();

  if (/^[A-Z]{2}$/.test(upperCompact)) return upperCompact;
  if (COUNTRY_ISO_MAP[s]) return COUNTRY_ISO_MAP[s];
  if (COUNTRY_ISO_MAP[compact]) return COUNTRY_ISO_MAP[compact];

  const found = Object.entries(COUNTRY_ISO_MAP).find(([key]) =>
    compact.includes(key.replace(/\s+/g, ""))
  );
  if (found) return found[1];

  return upperCompact || compact;
}

const makePriceKey = (group: string, country: string, name: string) =>
  `${group}__${country}__${name}`;

function runSelfTests() {
  if (normalizeCountry("브라질") !== "BR") throw new Error("SelfTest: normalizeCountry 브라질");
  if (normalizeCountry("  에티오피아 ") !== "ET") throw new Error("SelfTest: normalizeCountry trim");
  if (normalizeCountry("예맨") !== "YE") throw new Error("SelfTest: normalizeCountry 예맨");
  if (makePriceKey("(1)", "BR", "Santos") !== "(1)__BR__Santos") {
    throw new Error("SelfTest: makePriceKey");
  }
}

try {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    if (params.get("bb_selftest") === "1") runSelfTests();
  }
} catch {
  // ignore
}

export default function AutoOrderAppV15_3() {
  const [step, setStep] = useState(1);
  const [client, setClient] = useState("");
  const [priceGroup, setPriceGroup] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteType, setNoteType] = useState<"account" | "card" | null>(null);
  const [smallPack, setSmallPack] = useState(false);
  const [sameDay, setSameDay] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(false);

  const [toast, setToast] = useState("");
  const [toastMode, setToastMode] = useState<"normal" | "undo">("normal");
  const [undo, setUndo] = useState<{
    item: CartItem;
    index: number;
    expiresAt: number;
  } | null>(null);

  const [itemsAll, setItemsAll] = useState<PriceItem[]>([]);
  const [fileDate, setFileDate] = useState<string>("");
  const [sender, setSender] = useState<SalesPerson>("김용준");
  const [clientHistory, setClientHistory] = useState<ClientHistoryItem[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderHistoryItem[]>([]);
  const [manualPrices, setManualPrices] = useState<Record<string, number>>({});
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const priceInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    document.body.style.touchAction = "manipulation";
    (document.body.style as any).webkitTextSizeAdjust = "100%";
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Date.now() - parsed.savedAt < ONE_MONTH_MS) {
          setItemsAll(parsed.itemsAll || []);
          setFileDate(parsed.fileDate || "");
          setStep(2);

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

  useEffect(() => {
    try {
      localStorage.setItem(LS_SENDER_KEY, sender);
    } catch {
      // ignore
    }
  }, [sender]);

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

  useEffect(() => {
    if (!editingPriceKey) return;
    const t = setTimeout(() => {
      priceInputRef.current?.focus();
      priceInputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [editingPriceKey]);

  const message = useMemo(() => {
    const productTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const total = productTotal + (deliveryFee ? DELIVERY_FEE : 0);

    const orderLines = cart
      .filter((i) => i.quantity > 0)
      .map((i) => `${i.country} ${i.name} ${i.quantity}kg * ${i.price.toLocaleString()}원`);

    const optionLines: string[] = [];
    if (deliveryFee) {
      optionLines.push("");
      optionLines.push(`*배송비 ${DELIVERY_FEE.toLocaleString()}원`);
    }
    optionLines.push("");
    optionLines.push(`총 금액 ${total.toLocaleString()}원`);

    if (smallPack) optionLines.push("*5kg 소분 출고 요청");
    if (sameDay) optionLines.push("*금일 출고 요청");

    if (noteType === "card") {
      optionLines.push("");
      optionLines.push("*카드 결제 링크 요청 드립니다.");
    }

    if (noteType === "account") {
      optionLines.push("");
      optionLines.push("계좌번호 1006-901-483313 우리은행 블레스빈");
    }

    const extraNoticeLines = [
      "* 14시 전 입금시 당일출고",
      "* 입금 확인문자 부탁드립니다",
    ];

    return [
      "안녕하세요.",
      "바른생각",
      "다른커피",
      `블레스빈 ${sender}입니다.`,
      "요청하신 단가 안내드립니다.",
      "",
      client,
      "",
      ...orderLines,
      ...optionLines,
      "",
      ...extraNoticeLines,
    ].join("\n");
  }, [cart, noteType, client, sender, smallPack, sameDay, deliveryFee]);

  const pushRecentClient = useCallback((clientName: string) => {
    const name = (clientName ?? "").trim();
    if (!name) return;
    const now = Date.now();
    setClientHistory((prev) =>
      [{ name, lastUsedAt: now }, ...prev.filter((x) => x.name !== name)].slice(
        0,
        MAX_RECENT_CLIENTS
      )
    );
  }, []);

  const pushRecentOrder = useCallback(() => {
    const clientName = (client ?? "").trim();
    if (!clientName) return;

    const cartLines = cart
      .filter((i) => i.quantity > 0 && i.priceGroup === priceGroup)
      .map((x) => ({ ...x, country: normalizeCountry(x.country) }));

    if (cartLines.length === 0) return;

    const now = Date.now();
    const order: OrderHistoryItem = {
      id: String(now),
      client: clientName,
      sender,
      priceGroup: priceGroup || "",
      cart: cartLines,
      noteType,
      smallPack,
      sameDay,
      deliveryFee,
      fileDate,
      createdAt: now,
    };

    setOrderHistory((prev) => [order, ...prev].slice(0, MAX_RECENT_ORDERS));
  }, [client, cart, sender, priceGroup, noteType, smallPack, sameDay, deliveryFee, fileDate]);

  const loadRecentOrder = useCallback(
    (o: OrderHistoryItem) => {
      const nextGroup = o.priceGroup || "";

      const nextCart = (o.cart || [])
        .filter((x) => !nextGroup || x.priceGroup === nextGroup)
        .map((x) => {
          const normalizedCountry = normalizeCountry(x.country);
          const matched = itemsAll.find(
            (item) =>
              item.priceGroup === x.priceGroup &&
              item.country === normalizedCountry &&
              item.name === x.name
          );
          const key = makePriceKey(x.priceGroup, normalizedCountry, x.name);

          return {
            ...x,
            country: normalizedCountry,
            price: manualPrices[key] ?? matched?.price ?? x.price,
          };
        });

      setClient(o.client);
      setSender(o.sender);
      setPriceGroup(nextGroup);
      setCart(nextCart);
      setNoteType(o.noteType ?? null);
      setSmallPack(!!o.smallPack);
      setSameDay(!!o.sameDay);
      setDeliveryFee(!!o.deliveryFee);
      setSelectedCountry(null);
      setStep(nextGroup ? 4 : 3);
      setToastMode("normal");
      setToast("최근 주문 불러오기 완료!");
    },
    [itemsAll, manualPrices]
  );

  const deleteRecentOrder = useCallback((id: string) => {
    setOrderHistory((prev) => prev.filter((o) => o.id !== id));
    setToastMode("normal");
    setToast("주문 이력이 삭제되었습니다.");
  }, []);

  const filteredOrderHistory = useMemo(() => {
    const key = client.trim();
    if (!key) return orderHistory;
    return orderHistory.filter((o) => o.client === key);
  }, [orderHistory, client]);

  useEffect(() => {
    if (!priceGroup) return;

    setCart((prev) => {
      const next = prev.filter((x) => x.priceGroup === priceGroup);
      return next.length === prev.length ? prev : next;
    });
  }, [priceGroup]);

  const handleExcelUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });
      const collected: PriceItem[] = [];

      for (const sheet of wb.SheetNames) {
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], {
          header: 1,
          defval: "",
        });

        let nameIdx = -1;
        let priceIdx = -1;
        const countryIdx = 1;

        let headerRow = -1;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const hasNameHeader = row.some(
            (c) => typeof c === "string" && /(품명|제품명)/.test(c)
          );
          const hasPriceHeader = row.some(
            (c) => typeof c === "string" && /(단가|가격)/.test(c)
          );
          if (hasNameHeader && hasPriceHeader) {
            nameIdx = row.findIndex(
              (c) => typeof c === "string" && /(품명|제품명)/.test(c)
            );
            priceIdx = row.findIndex(
              (c) => typeof c === "string" && /(단가|가격)/.test(c)
            );
            headerRow = i;
            break;
          }
        }

        if (headerRow < 0 || nameIdx < 0 || priceIdx < 0) continue;

        let currentCountry = "";
        for (let j = headerRow + 1; j < rows.length; j++) {
          const item = rows[j];
          const rawCountry = item[countryIdx];
          const name = item[nameIdx];
          const price = item[priceIdx];

          const maybe = typeof rawCountry === "string" ? normalizeCountry(rawCountry) : "";
          if (maybe) currentCountry = maybe;

          if (typeof name === "string" && name && price && currentCountry) {
            const priceNum = Number(String(price).replace(/[\s,원₩,]/g, ""));
            if (!Number.isNaN(priceNum)) {
              collected.push({
                country: currentCountry,
                name: name.trim(),
                price: priceNum,
                priceGroup: sheet,
              });
            }
          }
        }
      }

      const match = file.name.match(/(20\d{2})(\d{2})/);
      const label = match ? `${match[1]}년 ${match[2]}월 단가표` : file.name;

      setFileDate(label);
      setItemsAll(collected);
      setPriceGroup("");
      setSelectedCountry(null);
      setCart([]);
      setNoteType(null);
      setSmallPack(false);
      setSameDay(false);
      setDeliveryFee(false);
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
    },
    []
  );

  const countries = useMemo(() => {
    return Array.from(
      new Set(itemsAll.filter((i) => i.priceGroup === priceGroup).map((i) => normalizeCountry(i.country)))
    ).sort((a, b) => a.localeCompare(b));
  }, [itemsAll, priceGroup]);

  const items = useMemo(
    () =>
      itemsAll.filter(
        (i) => normalizeCountry(i.country) === selectedCountry && i.priceGroup === priceGroup
      ),
    [itemsAll, selectedCountry, priceGroup]
  );

  const addToCart = useCallback(
    (item: PriceItem) => {
      const key = makePriceKey(item.priceGroup, item.country, item.name);
      const priceToUse = manualPrices[key] ?? item.price;

      setCart((prev) => {
        const exists = prev.find(
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

  const updateQty = useCallback((n: string, c: string, g: string, v: number) => {
    setCart((prev) =>
      prev.map((x) =>
        x.name === n && x.country === c && x.priceGroup === g
          ? { ...x, quantity: Math.max(x.quantity + v, 0) }
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

  const removeCartItemWithUndo = useCallback((target: CartItem, index: number) => {
    setCart((prev) =>
      prev.filter(
        (x) => !(x.name === target.name && x.country === target.country && x.priceGroup === target.priceGroup)
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
        (x) => x.name === undo.item.name && x.country === undo.item.country && x.priceGroup === undo.item.priceGroup
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
    if (Number.isNaN(numeric)) {
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

  const backToClient = () => {
    setStep(2);
    setClient("");
    setCart([]);
    setSelectedCountry(null);
    setNoteType(null);
    setSmallPack(false);
    setSameDay(false);
    setDeliveryFee(false);    setUndo(null);
    setToastMode("normal");
    setToast("초기화 완료");
  };

  return (
    <div className="flex flex-col min-h-screen bg-white text-lg">
      <header className="sticky top-0 z-50 bg-white border-b border-red-200 p-3 text-center font-bold text-red-700 text-xl">
        ☕ BlessBean AutoOrder v15.3
        {fileDate && <p className="text-sm text-gray-600 mt-1">📅 {fileDate}</p>}
      </header>

      <main className="flex-1 px-3 pb-28">
        {step === 1 && (
          <div className="mt-5 text-center text-gray-500">
            📂 오른쪽 아래 버튼으로 엑셀을 업로드하세요.
          </div>
        )}

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
            <div className="grid grid-cols-4 gap-2">
              {SALESPEOPLE.map((name) => (
                <button
                  key={name}
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
                <p className="text-center text-gray-600 font-semibold text-sm">최근 주문 (불러오기)</p>
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
                        ? `${normalizeCountry(o.cart[0].country)} ${o.cart[0].name}`
                        : `${normalizeCountry(o.cart[0].country)} ${o.cart[0].name} 외 ${itemCount - 1}개`;
                    const fileHint =
                      o.fileDate && fileDate && o.fileDate !== fileDate ? " (단가표 다름)" : "";

                    return (
                      <button
                        key={o.id}
                        onClick={() => loadRecentOrder(o)}
                        className="w-full text-left border border-gray-200 rounded-md p-3 bg-white active:scale-[0.99]"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-gray-800">{o.client}</span>
                          <span className="text-xs text-gray-500">{timeText}</span>
                        </div>

                        <div className="flex justify-end mt-1">
                          <button
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
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              disabled={!client}
              onClick={() => setStep(3)}
              className={`w-full py-3 rounded-md text-lg ${
                client ? "bg-red-600 text-white" : "bg-red-200 text-white"
              }`}
            >
              다음
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="mt-5 space-y-3">
            <p className="text-center text-red-700 font-semibold">3️⃣ 단가 그룹 선택</p>
            <div className="grid grid-cols-2 gap-3">
              {["(1)", "(2)", "(3)", "(4)"].map((g) => (
                <button
                  key={g}
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

        {step === 4 && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-5 gap-2">
              {countries.map((n) => (
                <button
                  key={n}
                  onClick={() => setSelectedCountry(normalizeCountry(n))}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    selectedCountry === n
                      ? "bg-red-600 text-white border-red-600"
                      : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  {normalizeCountry(n)}
                </button>
              ))}
            </div>

            {selectedCountry && (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {items.map((i) => {
                  const key = makePriceKey(i.priceGroup, i.country, i.name);
                  const displayPrice = manualPrices[key] ?? i.price;

                  return (
                    <div key={`${i.priceGroup}-${i.country}-${i.name}`} className="flex items-center gap-2">
                      <button
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
                        <span className="text-base whitespace-nowrap">{displayPrice.toLocaleString()}원</span>
                      </button>
                      <button
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

        {cart.length > 0 && (
          <div className="mt-6 mb-28">
            <p className="font-semibold text-red-700 flex items-start justify-between gap-3 mb-2">
              <span className="pt-1">🧺 장바구니</span>
              <span className="flex gap-2 flex-wrap justify-end leading-relaxed max-w-[75%]">
                <button
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
                  onClick={() => setSameDay(!sameDay)}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    sameDay
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-blue-100 text-blue-800 border-blue-300"
                  }`}
                >
                  금일
                </button>

                <button
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
                  onClick={() => setDeliveryFee(!deliveryFee)}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    deliveryFee
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-purple-100 text-purple-800 border-purple-300"
                  }`}
                >
                  [배송비]
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
                if (Number.isNaN(num)) return "";
                return `${num.toLocaleString()}원`;
              })();

              return (
                <div key={`${i.priceGroup}-${i.country}-${i.name}`} className="bg-red-50 border border-red-200 rounded-lg p-3 mb-2">
                  <p className="text-base text-red-800 break-words leading-snug">
                    {normalizeCountry(i.country)} {i.name} {i.quantity}kg * {i.price.toLocaleString()}원
                  </p>

                  <div className="flex justify-between items-start gap-3 mt-3">
                    <div className="flex gap-2 flex-wrap content-start">
                      {[1, 5, 20].map((v) => (
                        <button
                          key={v}
                          onClick={() => updateQty(i.name, i.country, i.priceGroup, v)}
                          className="bg-red-200 text-red-800 text-sm px-4 py-2 rounded-md active:scale-95"
                        >
                          +{v}
                        </button>
                      ))}
                      <button
                        onClick={() => updateQty(i.name, i.country, i.priceGroup, -i.quantity)}
                        className="bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded-md"
                      >
                        0kg
                      </button>
                      <button
                        onClick={() => editPrice(i)}
                        className="bg-white border border-red-300 text-red-700 text-sm px-3 py-2 rounded-md active:scale-95"
                      >
                        단가
                      </button>
                      <button
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
                          if (Number.isNaN(num)) return;
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
                        onClick={() => applyPriceEdit(i)}
                        className="bg-red-600 text-white text-xs px-3 py-1 rounded-md active:scale-95"
                      >
                        확인
                      </button>
                      <button
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
        className="fixed left-4 right-4 z-50 pointer-events-none flex justify-between items-end"
        style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
      >
        <div className="pointer-events-auto">
          <button
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
            <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload} className="hidden" />
          </label>

          {cart.length > 0 && (
            <button
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
            <button onClick={undoRemove} className="underline font-semibold" aria-label="삭제 되돌리기">
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
