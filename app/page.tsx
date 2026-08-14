"use client";

import { useEffect, useState } from "react";
import { RefreshCw, AlertCircle, Trophy } from "lucide-react";

// 1. MAPPING TABLE WITH ODDS & NORMALIZED NAMES
const PARTICIPANT_MAPPING = [
  { originalOrder: 1, pandejo: "Chris", golferName: "Scottie Scheffler", odds: 450, displayOdds: "+450" },
  { originalOrder: 2, pandejo: "Zach", golferName: "Rory McIlroy", odds: 1050, displayOdds: "+1050" },
  { originalOrder: 3, pandejo: "Danny", golferName: "Xander Schauffele", odds: 1850, displayOdds: "+1850" },
  { originalOrder: 4, pandejo: "Oscar", golferName: "Cameron Young", odds: 1900, displayOdds: "+1900" },
  { originalOrder: 5, pandejo: "Diego", golferName: "Tommy Fleetwood", odds: 2000, displayOdds: "+2000" },
  { originalOrder: 6, pandejo: "Casey", golferName: "Sam Burns", odds: 2200, displayOdds: "+2200" },
  { originalOrder: 7, pandejo: "Travis", golferName: "Matt Fitzpatrick", odds: 2250, displayOdds: "+2250" },
  { originalOrder: 8, pandejo: "Charley", golferName: "Ludvig Åberg", odds: 2400, displayOdds: "+2400" },
  { originalOrder: 9, pandejo: "CJ", golferName: "Collin Morikawa", odds: 2800, displayOdds: "+2800" },
  { originalOrder: 10, pandejo: "Bobby", golferName: "Hideki Matsuyama", odds: 2900, displayOdds: "+2900" },
  { originalOrder: 11, pandejo: "Clint", golferName: "Patrick Cantlay", odds: 3100, displayOdds: "+3100" },
  { originalOrder: 12, pandejo: "Aldo", golferName: "Si Woo Kim", odds: 3300, displayOdds: "+3300" },
];

const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";
const ESPN_SUMMARY = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/summary";

// String normalizer to match variations like "Ludvig Aberg" vs "Ludvig Åberg"
function normalizeName(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ll/g, "l")
    .toLowerCase()
    .trim();
}

interface ProcessedGolfer {
  projectedPick: number;
  pandejo: string;
  golferName: string;
  displayOdds: string;
  odds: number;
  score: string;
  rawScore: number;
  position: string;
  through: string;
  isCutOrOut: boolean;
  statusText: string;
}

export default function Home() {
  const [standings, setStandings] = useState<ProcessedGolfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  async function fetchLiveDraftOrder() {
    setLoading(true);
    try {
      // Step 1: Get current event ID from scoreboard
      const sbRes = await fetch(`${ESPN_SCOREBOARD}?_=${Date.now()}`);
      if (!sbRes.ok) throw new Error(`Scoreboard HTTP ${sbRes.status}`);
      const sbData = await sbRes.json();

      const eventId = sbData?.events?.[0]?.id;
      let competitors: any[] = sbData?.events?.[0]?.competitions?.[0]?.competitors || [];

      // Step 2: Fetch deep summary endpoint if event ID is present
      if (eventId) {
        try {
          const sumRes = await fetch(`${ESPN_SUMMARY}?event=${eventId}&_=${Date.now()}`);
          if (sumRes.ok) {
            const sumData = await sumRes.json();
            const detailedComp = sumData?.leaderboard?.competitors;
            if (detailedComp && detailedComp.length > 0) {
              competitors = detailedComp;
            }
          }
        } catch (sumErr) {
          console.warn("Summary endpoint fetch failed, falling back to scoreboard:", sumErr);
        }
      }

      // Step 3: Map competitors with robust field inspection
      const mapped: ProcessedGolfer[] = PARTICIPANT_MAPPING.map((item) => {
        const normalizedTarget = normalizeName(item.golferName);

        const match = competitors.find((c: any) => {
          const name = normalizeName(c.athlete?.displayName || "");
          return name.includes(normalizedTarget) || normalizedTarget.includes(name);
        });

        // 1. Raw score parsing
        const scoreStr = match?.score || match?.totalScore || match?.linescores?.[0]?.value || "E";
        let rawScore = 0;
        if (typeof scoreStr === "number") {
          rawScore = scoreStr;
        } else if (scoreStr === "E" || scoreStr === "EVEN") {
          rawScore = 0;
        } else {
          const parsed = parseInt(String(scoreStr).replace("+", ""), 10);
          rawScore = isNaN(parsed) ? 0 : parsed;
        }

        // 2. Cut / Out Detection
        const statusType = (match?.status?.type?.name || match?.status?.type?.state || "").toLowerCase();
        const detail = (match?.status?.type?.shortDetail || match?.status?.type?.detail || "").toLowerCase();
        const displayVal = (match?.status?.displayValue || "").toUpperCase();

        const isCutOrOut =
          statusType.includes("cut") ||
          detail.includes("cut") ||
          detail.includes("wd") ||
          detail.includes("dq") ||
          displayVal === "CUT";

        // 3. Exact Tournament Position Extraction
        let pos = "-";
        if (match?.status?.position?.displayName) {
          pos = match.status.position.displayName;
        } else if (typeof match?.status?.position === "string" || typeof match?.status?.position === "number") {
          pos = String(match.status.position);
        } else if (match?.rank) {
          pos = `T${match.rank}`;
        } else if (match?.place) {
          pos = String(match.place);
        } else if (match?.order) {
          pos = String(match.order);
        }

        // 4. Robust "THRU" Extraction Chain
        let thru = "-";
        const shortDetail = match?.status?.type?.shortDetail || match?.status?.type?.detail || "";
        const isCompleted = match?.status?.type?.completed || shortDetail === "F" || shortDetail === "FINAL";

        const rawThru =
          match?.status?.displayThru ??
          match?.displayThru ??
          match?.status?.thru ??
          match?.thru ??
          match?.status?.hole ??
          match?.hole;

        if (isCompleted) {
          thru = "F";
        } else if (rawThru !== undefined && rawThru !== null && rawThru !== "" && rawThru !== 0) {
          thru = String(rawThru);
        } else if (shortDetail && !shortDetail.toUpperCase().includes("SCHEDULED")) {
          thru = shortDetail;
        } else {
          // Check active round linescores
          const activeRound = Array.isArray(match?.linescores) ? match.linescores[match.linescores.length - 1] : null;
          if (activeRound?.thru) {
            thru = String(activeRound.thru);
          } else if (activeRound?.displayValue) {
            thru = String(activeRound.displayValue);
          } else {
            thru = "Tee";
          }
        }

        return {
          projectedPick: 0,
          pandejo: item.pandejo,
          golferName: item.golferName,
          displayOdds: item.displayOdds,
          odds: item.odds,
          score: typeof scoreStr === "number" ? (scoreStr > 0 ? `+${scoreStr}` : scoreStr === 0 ? "E" : `${scoreStr}`) : String(scoreStr),
          rawScore,
          position: pos,
          through: thru,
          isCutOrOut,
          statusText: isCutOrOut ? "CUT / OUT" : shortDetail || "Active",
        };
      });

      // SORTING LOGIC:
      // 1. Active players above CUT/WD/DQ players.
      // 2. Lowest relative score drafts 1st (e.g. -6 beats -4).
      // 3. TIE BREAKER: Longer/worst opening odds win (higher numerical oddsValue beats lower).
      mapped.sort((a, b) => {
        if (a.isCutOrOut !== b.isCutOrOut) {
          return a.isCutOrOut ? 1 : -1;
        }

        if (a.rawScore !== b.rawScore) {
          return a.rawScore - b.rawScore;
        }

        // Tie Breaker: Worst opening odds (+3300 beats +450)
        return b.odds - a.odds;
      });

      // Assign final projected pick 1 to 12
      const formatted = mapped.map((item, idx) => ({
        ...item,
        projectedPick: idx + 1,
      }));

      setStandings(formatted);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError("Failed to pull live score data directly from ESPN.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLiveDraftOrder();
    const interval = setInterval(fetchLiveDraftOrder, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-emerald-400 flex items-center gap-2">
            <Trophy className="w-7 h-7 text-yellow-500" /> Projected Draft Order
          </h1>
          <p className="text-slate-400 text-xs md:text-sm mt-1">
            Lowest Score Drafts 1st • Tie-Breaker: Worst Opening Odds • Cut/WD Locked at Bottom
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-xs font-mono text-slate-500">
              Updated {lastUpdated}
            </span>
          )}
          <button
            onClick={fetchLiveDraftOrder}
            disabled={loading}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 bg-rose-950/60 border border-rose-800 text-rose-200 p-4 rounded-xl text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Leaderboard Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-800/80 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                <th className="py-3 px-4 text-center">Pick</th>
                <th className="py-3 px-4">Pandejo</th>
                <th className="py-3 px-4">Golfer</th>
                <th className="py-3 px-4 text-center">Odds</th>
                <th className="py-3 px-4 text-center">Tourn Pos</th>
                <th className="py-3 px-4 text-right">Score</th>
                <th className="py-3 px-4 text-right">Thru</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-sm">
              {standings.map((row) => (
                <tr
                  key={row.golferName}
                  className={`transition-colors ${
                    row.isCutOrOut ? "bg-rose-950/20 text-slate-500" : "hover:bg-slate-800/40"
                  }`}
                >
                  <td className="py-3.5 px-4 text-center font-mono font-bold">
                    <span
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs ${
                        row.projectedPick === 1
                          ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
                          : row.projectedPick <= 3
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "text-slate-400"
                      }`}
                    >
                      #{row.projectedPick}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 font-bold text-slate-200">
                    {row.pandejo}
                  </td>
                  <td className="py-3.5 px-4 font-medium text-slate-100 flex items-center gap-2">
                    {row.golferName}
                    {row.isCutOrOut && (
                      <span className="text-[10px] bg-rose-900/60 text-rose-300 px-1.5 py-0.5 rounded border border-rose-700 font-semibold">
                        CUT/OUT
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-400 text-xs">
                    {row.displayOdds}
                  </td>
                  <td className="py-3.5 px-4 text-center font-mono text-slate-300">
                    {row.position}
                  </td>
                  <td
                    className={`py-3.5 px-4 text-right font-bold font-mono ${
                      row.isCutOrOut
                        ? "text-rose-400 line-through"
                        : row.score.startsWith("-")
                        ? "text-emerald-400"
                        : row.score.startsWith("+")
                        ? "text-rose-400"
                        : "text-slate-300"
                    }`}
                  >
                    {row.score}
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-slate-400 text-xs">
                    {row.through}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
