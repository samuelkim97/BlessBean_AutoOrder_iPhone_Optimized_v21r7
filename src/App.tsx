
import { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";

// ====== Types ======
type PriceItem = { country: string; name: string; price: number; priceGroup: string };
type CartItem = { name: string; country: string; price: number; quantity: number };

// ====== Constants ======
const LS_KEY = "blessbean_priceList_v15_3";
const ONE_MONTH_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_ROWS_SAFE = 20000; // iPhone 메모리 보호용
const ALLOWED_SHEETS = new Set(["(1)", "(2)", "(3)", "(4)"]); // 단가 그룹

const COUNTRY_ISO_MAP: Record<string, string> = {
  브라질: "BR", 콜롬비아: "CO", 에티오피아: "ET", 과테말라: "GT", 인도네시아: "ID",
  인도: "IN", 케냐: "KE", 엘살바도르: "SV", 온두라스: "HN", 자메이카: "JM",
  탄자니아: "TN", 디카페인: "[디카페인]", 베트남: "VN", 코스타리카: "CR",
  니카라과: "NI", 멕시코: "MX", 페루: "PE", 파푸아뉴기니: "PG", 예멘: "YE",
  르완다: "RW", 우간다: "UG", 파나마: "PA", 하와이: "US"
};

// ====== Utility ======
function sanitizeText(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFC")
    .replace(/\u00A0/g, " ") // NBSP -> space
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width 제거
    .replace(/[\r\t]/g, " ") // CR/TAB -> space
    .replace(/\s+/g, " ") // 공백 정리
    .trim();
}

function normalizeCountry(raw: string): string {
  let s = sanitizeText(raw);
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => t.length === 1)) s = tokens.join("");
  if (COUNTRY_ISO_MAP[s]) s = COUNTRY_ISO_MAP[s];
  return s;
}

// ====== App ======
export default function AutoOrderApp_Optimized_iOS() {
  const [step, setStep] = useState(1);
  const [client, setClient] = useState("");
  const [priceGroup, setPriceGroup] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [noteType, setNoteType] = useState<"account" | "card" | null>(null);
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState("");
  const [itemsAll, setItemsAll] = useState<PriceItem[]>([]);
  const [fileDate, setFileDate] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // iPhone 터치 확대/더블탭 방지 설정
  useEffect(() => {
    document.body.style.touchAction = "manipulation";
    (document.body.style as any).webkitTextSizeAdjust = "100%";
  }, []);

  // 캐시 복구
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Date.now() - parsed.savedAt < ONE_MONTH_MS) {
          setItemsAll(parsed.itemsAll || []);
          setFileDate(parsed.fileDate || "");
          setStep(2);
        }
      }
    } catch {}
  }, []);

  // 토스트 자동 닫힘
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 1400);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // 최종 문구 생성 (줄바꿈은 실제 \n)
  useEffect(() => {
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const lines = cart
      .filter((i) => i.quantity > 0)
      .map((i) => `${i.country} ${i.name} ${i.quantity}kg * ${i.price.toLocaleString()}원`)
      .join("\n");

    const note =
      noteType === "account"
        ? "\n\n계좌번호 1006-901-483313 우리은행 블레스빈\n* 입금 확인 문자 부탁드립니다."
        : noteType === "card"
        ? "\n\n카드 결제 링크 요청 드립니다."
        : "";

    setMessage(
      `안녕하세요, 블레스빈 김용준입니다.\n요청하신 단가 안내드립니다.\n\n${client}\n\n${lines}\n\n총 금액 ${total.toLocaleString()}원${note}`
    );
  }, [cart, noteType, client]);

  // ====== Excel Upload (iPhone '파일' 앱 완전 지원) ======
  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // iOS 파일 앱: MIME과 확장자를 넉넉히 허용
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream"
    ];
    if (!allowed.includes(file.type) && !/\.xlsx?$/.test(file.name)) {
      setToast("엑셀(.xlsx/.xls) 파일만 업로드 가능합니다.");
      e.currentTarget.value = "";
      return;
    }

    // 큰 파일 방지(실무 단가표는 보통 수 MB 이하)
    if (file.size > 10 * 1024 * 1024) {
      setToast("파일 용량이 큽니다. 10MB 이하로 줄여주세요.");
      e.currentTarget.value = "";
      return;
    }

    setLoading(true);
    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data, { type: "array" });

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error("시트를 찾을 수 없습니다.");
      }

      const collected: PriceItem[] = [];

      for (const sheet of wb.SheetNames) {
        // (1)~(4) 아니면 스킵 (잡시트 방지)
        if (!ALLOWED_SHEETS.has(sheet)) continue;

        const ws = wb.Sheets[sheet];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (rows.length > MAX_ROWS_SAFE) {
          throw new Error(`시트가 너무 큽니다 (${rows.length}행). 파일을 정리해 주세요.`);
        }

        let nameIdx = -1, priceIdx = -1;
        const countryIdx = 1; // B열(나라)

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];

          // 헤더 감지 (품명/제품명, 단가/가격)
          if (row.some((c) => typeof c === "string" && /(품명|제품명)/.test(c))) {
            nameIdx = row.findIndex((c) => typeof c === "string" && /(품명|제품명)/.test(c));
            priceIdx = row.findIndex((c) => typeof c === "string" && /(단가|가격)/.test(c));

            if (nameIdx === -1 || priceIdx === -1) continue; // 불완전 헤더 보호

            let currentCountry = "";

            for (let j = i + 1; j < rows.length; j++) {
              const item = rows[j];
              const rawCountry = item[countryIdx];
              const name = sanitizeText(String(item[nameIdx] ?? ""));
              const priceRaw = item[priceIdx];

              const maybe = typeof rawCountry === "string" ? normalizeCountry(rawCountry) : "";
              if (maybe) currentCountry = maybe; // 같은 나라 블록 유지

              if (!name || !priceRaw || !currentCountry) continue;

              const priceNum = Number(String(priceRaw).replace(/[\s,원₩]/g, ""));
              if (Number.isFinite(priceNum) && priceNum > 0) {
                collected.push({ country: currentCountry, name, price: priceNum, priceGroup: sheet });
              }
            }
          }
        }
      }

      if (collected.length === 0) {
        throw new Error("유효한 품목을 찾지 못했습니다. 시트명(1~4), B/C/D 열 구조를 확인하세요.");
      }

      const match = file.name.match(/(20\d{2})(\d{2})/);
      const label = match ? `${match[1]}년 ${match[2]}월 단가표` : file.name;

      setFileDate(label);
      setItemsAll(collected);
      localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), itemsAll: collected, fileDate: label }));
      setStep(2);
      setToast("단가표 로드 완료!");
    } catch (err: any) {
      console.error(err);
      setToast(err?.message || "엑셀을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      e.currentTarget.value = ""; // 동일 파일 재업로드 허용
    }
  }, []);

  // ====== Memoized Collections ======
  const countries = useMemo(
    () => Array.from(new Set(itemsAll.filter((i) => i.priceGroup === priceGroup).map((i) => i.country))),
    [itemsAll, priceGroup]
  );

  const items = useMemo(
    () => itemsAll.filter((i) => i.country === selectedCountry && i.priceGroup === priceGroup),
    [itemsAll, selectedCountry, priceGroup]
  );

  // ====== Cart Helpers ======
  const addToCart = (n: string, p: number, c: string) =>
    setCart((prev) => (prev.find((x) => x.name === n && x.country === c) ? prev : [...prev, { name: n, price: p, country: c, quantity: 0 }]));

  const updateQty = (n: string, c: string, v: number) =>
    setCart((prev) => prev.map((x) => (x.name === n && x.country === c ? { ...x, quantity: Math.max(x.quantity + v, 0) } : x)));

  const removeFromCart = (n: string, c: string) => setCart((prev) => prev.filter((x) => !(x.name === n && x.country === c)));

  // ====== Copy ======
  const copyToClipboard = async () => {
    if (!message) return setToast("복사할 문구가 없습니다.");
    try {
      await navigator.clipboard.writeText(message);
      setToast("문구 복사 완료!");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = message;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setToast("문구 복사 완료!");
    }
  };

  const backToClient = () => {
    setStep(2);
    setClient("");
    setCart([]);
    setSelectedCountry(null);
    setNoteType(null);
    setMessage("");
    setToast("초기화 완료");
  };

  // ====== UI ======
  return (
    <div className="flex flex-col min-h-screen bg-white text-lg">
      <header className="sticky top-0 z-50 bg-white border-b border-red-200 p-3 text-center font-bold text-red-700 text-xl">
        ☕ BlessBean AutoOrder • iPhone Optimized
        {fileDate && <p className="text-sm text-gray-600 mt-1">📅 {fileDate}</p>}
      </header>

      <main className="flex-1 px-3 pb-28">
        {step === 1 && (
          <div className="mt-6 text-center text-gray-600">
            📂 오른쪽 아래 버튼으로 엑셀(.xlsx/.xls)을 업로드하세요. (iPhone "파일" 앱 지원)
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
              inputMode="text"
              autoCapitalize="off"
            />
            <button
              disabled={!client}
              onClick={() => setStep(3)}
              className={`w-full py-3 rounded-md text-lg ${client ? "bg-red-600 text-white" : "bg-red-200 text-white"}`}
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
                    setStep(4);
                  }}
                  className="py-4 bg-red-100 border border-red-300 text-red-800 text-xl rounded-md active:scale-95"
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
                  onClick={() => setSelectedCountry(n)}
                  className={`text-xs px-2 py-1 rounded-md border ${
                    selectedCountry === n ? "bg-red-600 text-white border-red-600" : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            {selectedCountry && (
              <div className="mt-2 grid grid-cols-1 gap-2">
                {items.map((i) => (
                  <div key={i.name} className="flex items-center gap-2">
                    <button
                      onClick={() => addToCart(i.name, i.price, i.country)}
                      className="flex-1 justify-between bg-red-50 text-red-800 border border-red-300 px-4 py-3 text-base rounded-md active:scale-95 flex items-center"
                    >
                      <span className="truncate pr-3">{i.name}</span>
                      <span>{i.price.toLocaleString()}원</span>
                    </button>
                    <button onClick={() => removeFromCart(i.name, i.country)} className="px-3 py-3 rounded-md border border-red-300 text-red-700">
                      ❌
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {cart.length > 0 && (
          <div className="mt-6 mb-28">
            <p className="font-semibold text-red-700 flex items-center justify-between mb-2">
              🧺 장바구니
              <span className="flex gap-2">
                <button
                  onClick={() => setNoteType(noteType === "account" ? null : "account")}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    noteType === "account" ? "bg-red-600 text-white border-red-600" : "bg-red-100 text-red-800 border-red-300"
                  }`}
                >
                  [계좌번호]
                </button>
                <button
                  onClick={() => setNoteType(noteType === "card" ? null : "card")}
                  className={`text-xs px-3 py-2 rounded-md border ${
                    noteType === "card" ? "bg-yellow-500 text-white border-yellow-500" : "bg-yellow-100 text-yellow-800 border-yellow-300"
                  }`}
                >
                  [카드결제]
                </button>
              </span>
            </p>

            {cart.map((i) => (
              <div key={`${i.country}-${i.name}`} className="bg-red-50 border border-red-200 rounded-lg p-3 mb-2">
                <p className="text-base text-red-800">
                  {i.country} {i.name} {i.quantity}kg * {i.price.toLocaleString()}원
                </p>
                <div className="flex justify-between items-center mt-2">
                  <div className="flex gap-2">
                    {[1, 5, 20].map((v) => (
                      <button
                        key={v}
                        onClick={() => updateQty(i.name, i.country, v)}
                        className="bg-red-200 text-red-800 text-sm px-4 py-2 rounded-md active:scale-95"
                      >
                        +{v}
                      </button>
                    ))}
                    <button onClick={() => updateQty(i.name, i.country, -i.quantity)} className="bg-gray-200 text-gray-800 text-sm px-4 py-2 rounded-md">
                      0kg
                    </button>
                    <button onClick={() => removeFromCart(i.name, i.country)} className="bg-red-600 text-white text-sm px-4 py-2 rounded-md active:scale-95">
                      삭제
                    </button>
                  </div>
                  <span className="text-red-700 font-semibold text-sm">{i.quantity}kg</span>
                </div>
              </div>
            ))}

            <div className="bg-red-50 border border-red-200 p-4 whitespace-pre-wrap text-sm text-red-800 mt-3 rounded-md">{message}</div>
          </div>
        )}

        {loading && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-white rounded-xl px-6 py-4 border border-red-200 text-red-700 shadow">
              엑셀을 읽는 중입니다… (iPhone)
            </div>
          </div>
        )}
      </main>

      <footer className="fixed bottom-4 left-4 right-4 z-50 pointer-events-none flex justify-between items-end">
        <div className="pointer-events-auto">
          <button onClick={backToClient} className="bg-white border border-blue-300 text-blue-700 text-base rounded-full px-4 h-12 shadow-md active:scale-95">
            📋 거래처 입력
          </button>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-3">
          <label
            className="bg-white border border-red-300 rounded-full p-3 shadow-md cursor-pointer hover:bg-red-50 active:scale-95"
            aria-label="엑셀 업로드"
          >
            📂
            {/* iPhone '파일' 앱 호환 MIME + 확장자 */}
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>
          {cart.length > 0 && (
            <button onClick={copyToClipboard} className="bg-red-600 text-white text-xl rounded-full w-20 h-20 shadow-lg active:scale-95">
              복사
            </button>
          )}
        </div>
      </footer>

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-red-600 text-white text-sm px-4 py-2 rounded-md shadow-md">
          {toast}
        </div>
      )}
    </div>
  );
}
