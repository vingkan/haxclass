const isLocal = document.location.hostname === "localhost" && document.location.href.indexOf("l=false") == -1;
const HAXML_SERVER = isLocal ? "http://localhost:5000" : "https://haxml.herokuapp.com";

const INITIAL_ELO = 1500;

function getELOForTeamAverage(eloScores) {
    if (eloScores.length > 0) {
        return eloScores.reduce((agg, val) => agg + val, 0) / eloScores.length;
    }
    return 0;
}

function getELOForTeamSum(eloScores) {
    if (eloScores.length > 0) {
        return eloScores.reduce((agg, val) => agg + val, 0);
    }
    return 0;
}

function getELOWinProbability(ourELO, oppELO, d=400) {
    const validScores = !(isNaN(ourELO) || isNaN(oppELO));
    const validSpread = d > 0;
    if (validScores && validSpread) {
        const exp = (oppELO - ourELO) / d;
        const prob = 1 / (1 + Math.pow(10, exp));
        return prob;
    }
    return 0.5;
}

function getELOForMatchBinary(eloA, eloB, wonByA, k=40, d=400) {
    const winProbA = getELOWinProbability(eloA, eloB, d);
    const expectedScore = winProbA;
    const actualScore = wonByA ? 1 : 0;
    const eloChange = k * (actualScore - expectedScore);
    return Math.abs(eloChange);
}

function getELOForMatchGoals(eloA, eloB, goalDiffA, k=40, d=400) {
    const winProbA = getELOWinProbability(eloA, eloB, d);
    const expectedScore = winProbA;
    const actualScore = goalDiffA > 0 ? 1 : 0;
    const eloChange = k * Math.abs(goalDiffA) * (actualScore - expectedScore);
    return Math.abs(eloChange);
}

function ranksFromSummaries(rawSummaries, eloParams) {
    const summaries = rawSummaries ? rawSummaries : [];
    let rankedMatches = [];
    const playerRankMap = summaries.reduce((playerMap, s) => {
        // Skip matches that don't split players by team.
        const hasPlayersByTeam = s.playersRed || s.playersBlue;
        if (!hasPlayersByTeam) {
            return playerMap;
        }
        // Extract name, team, and outcome for each player.
        const wonByRed = s.scoreRed > s.scoreBlue;
        const goalDiffRed = s.scoreRed - s.scoreBlue;
        const parseTeam = (rawNames, team) => {
            const won = team === "red" ? wonByRed : !wonByRed;
            const goalDiff = team === "red" ? goalDiffRed : -1 * goalDiffRed;
            const names = rawNames ? rawNames.split(", ") : [];
            return names.map((name) => {
                return {
                    name,
                    team,
                    won,
                    goalDiff,
                };
            });
        };
        const playersRed = parseTeam(s.playersRed, "red");
        const playersBlue = parseTeam(s.playersBlue, "blue");
        const allPlayers = [ ...playersRed, ...playersBlue ];
        // Add initial player entries to player map.
        allPlayers.forEach((record) => {
            const { name, team, won } = record;
            if (!(name in playerMap)) {
                playerMap[name] = {
                    name,
                    wins: 0,
                    losses: 0,
                    goalDiff: 0,
                    eloRating: INITIAL_ELO,
                    eloHistory: [INITIAL_ELO],
                    winningStreak: false,
                    streakSize: 0,
                };
            }
        });
        const getPlayerELO = ({ name }) => {
            return playerMap[name].eloRating;
        };
        const { k, d, mode, method } = eloParams;
        // Default to average score.
        let getELOForTeam = getELOForTeamAverage;
        if (method === "average") {
            getELOForTeam = getELOForTeamAverage;
        } else if (method === "sum") {
            getELOForTeam = getELOForTeamSum;
        }
        const eloRed = getELOForTeam(playersRed.map(getPlayerELO));
        const eloBlue = getELOForTeam(playersBlue.map(getPlayerELO));
        // Default to binary ELO scoring.
        let eloMatch;
        if (mode === "binary") {
            eloMatch = getELOForMatchBinary(eloRed, eloBlue, wonByRed, k, d);
        } else if (mode === "goals") {
            eloMatch = getELOForMatchGoals(eloRed, eloBlue, goalDiffRed, k, d);
        } else {
            eloMatch = getELOForMatchBinary(eloRed, eloBlue, wonByRed, k, d);
        }
        const winProbRed = getELOWinProbability(eloRed, eloBlue, d);
        // Add match data to ranked matches list.
        const rankedMatch = {
            ...s,
            playersRed,
            playersBlue,
            eloRed,
            eloBlue,
            winProbRed,
            winProbBlue: 1 - winProbRed,
            eloMatch,
        };
        rankedMatches.push(rankedMatch);
        // Update entries for players in the match.
        let updatedPlayers = {};
        allPlayers.forEach((record) => {
            const { name, team, won, goalDiff } = record;
            const lastELO = playerMap[name].eloRating;
            let nextELO = lastELO;
            if (won) {
                playerMap[name].wins++;
                nextELO = lastELO + eloMatch;
            } else {
                playerMap[name].losses++;
                nextELO = lastELO - eloMatch;
            }
            playerMap[name].eloRating = nextELO;
            playerMap[name].eloHistory.push(nextELO);
            playerMap[name].goalDiff += goalDiff;
            updatedPlayers[name] = true;
            const { winningStreak, streakSize } = playerMap[name];
            // For the player's first match, streakSize will be 0.
            if (streakSize === 0) {
                if (won) {
                    playerMap[name].winningStreak = true;
                    playerMap[name].streakSize = 1;    
                } else {
                    playerMap[name].winningStreak = false;
                    playerMap[name].streakSize = 1;
                }
            } else {
                const streakContinues = winningStreak === won;
                if (streakContinues) {
                    playerMap[name].streakSize++;
                } else {
                    playerMap[name].winningStreak = won;
                    playerMap[name].streakSize = 1;
                }
            }
        });
        // Update entries for players NOT in the match.
        Object.keys(playerMap).forEach((name) => {
            if (!(name in updatedPlayers)) {
                const currentELO = playerMap[name].eloRating
                playerMap[name].eloHistory.push(currentELO);
            }
        });
        return playerMap;
    }, {});
    const rankedPlayers = toList(playerRankMap).sort((a, b) => {
        return b.eloRating - a.eloRating;
    }).map((p, i) => {
        return {
            ...p,
            rank: i + 1,
        }
    });
    return { rankedPlayers, rankedMatches };
}

function styleProb(prob) {
    return {
        background: `rgba(${FUTSAL_RGB}, ${prob})`,
    };
}

function styleELO(elo, mi, ma) {
    return {
        background: `rgba(${FUTSAL_RGB}, ${getAlpha(elo, 1100, 1900)})`,
    };
}

function tableRankedPlayers(rankedPlayers) {
    const headers = [
        { key: "rank", name: "Rank" },
        { key: "name", name: "Player" },
        { key: "matches", name: "Matches" },
        { key: "wins", name: "Wins" },
        { key: "losses", name: "Losses" },
        { key: "eloRating", name: "ELO Rating", style: (r) => styleELO(r.eloRating) },
        { key: "goalDiff", name: "Goal Diff" },
        { key: "streak", name: "Streak" },
    ];
    const rows = rankedPlayers.map((p, i) => {
        const diff = p.goalDiff;
        const streakAbbr = `${p.winningStreak ? "W" : "L"}${p.streakSize}`;
        return {
            rank: p.rank,
            name: p.name,
            matches: p.wins + p.losses,
            wins: p.wins,
            losses: p.losses,
            elo: p.eloRating,
            eloRating: (p.eloRating).toFixed(0),
            goalDiff: diff > 0 ? `+${diff}` : diff,
            streak: streakAbbr,
        };
    });
    return { headers, rows };
}

function tableRankedMatches(rankedMatches) {
    const headers = [
        { key: "saved", name: "Date/Time" },
        { key: "duration", name: "Duration" },
        { key: "winner", name: "Winner" },
        { key: "winProb", name: "Win Prob", style: (r) => styleProb(r.winProb) },
        { key: "finalScore", name: "Final Score" },
        { key: "teamRed", name: "Red Team" },
        { key: "eloRatingRed", name: "Red ELO", style: (r) => styleELO(r.eloRed) },
        { key: "teamBlue", name: "Blue Team" },
        { key: "eloRatingBlue", name: "Blue ELO", style: (r) => styleELO(r.eloBlue) },
    ];
    const rows = rankedMatches.sort((a, b) => {
        return b.saved - a.saved;
    }).map((m, i) => {
        const redWon = m.scoreRed > m.scoreBlue;
        const winProb = redWon ? m.winProbRed : m.winProbBlue;
        return {
            saved: formatCompactMatchTimeString(m.saved),
            duration: toClock(m.time),
            winner: redWon ? "Red" : "Blue",
            winProb: winProb.toFixed(3),
            finalScore: `${m.scoreRed} - ${m.scoreBlue}`,
            teamRed: m.playersRed.map(p => p.name).join(", "),
            eloRed: m.eloRed,
            eloRatingRed: m.eloRed.toFixed(0),
            teamBlue: m.playersBlue.map(p => p.name).join(", "),
            eloBlue: m.eloBlue,
            eloRatingBlue: m.eloBlue.toFixed(0),
        };
    });
    return { headers, rows };
}

function LeaderboardMain(props) {
    const [ isLoading, setIsLoading ] = React.useState(false);
    const eloParams = { k: 100, d: 400, mode: "binary", method: "average" };
    const { rankedPlayers, rankedMatches}  = ranksFromSummaries(props.summaries, eloParams);
    const nRankedMatches = plur(rankedMatches.length, "match", "matches");
    console.log(rankedPlayers);
    console.log(rankedMatches);
    return (
        <div className={`MainContainer Leaderboard ${isLoading ? "Loading" : ""}`}>
            <div className="Loader">
                <div class="lds"><div></div><div></div><div></div></div>
            </div>
            <section>
                <h1>Leaderboard</h1>
                <p>Rankings based on {nRankedMatches} over the last 6 hours.</p>
                <StatsTable
                    table={tableRankedPlayers(rankedPlayers)}
                    title={"Ranked Players"}
                    isSearchable={true}
                />
                <br />
                <StatsTable
                    table={tableRankedMatches(rankedMatches)}
                    title={"Ranked Matches"}
                    isSearchable={true}
                />
            </section>
        </div>
    );
}

function renderMain(summaries) {
    const mainEl = document.getElementById("main");
    const mainRe = (
        <LeaderboardMain
            summaries={summaries}
        />
    );
    ReactDOM.unmountComponentAtNode(mainEl);
    ReactDOM.render(mainRe, mainEl);
}

let fromDate = new Date();
fromDate.setHours(fromDate.getHours() - 6);

renderMain(null);
const summaryRef = db.ref("summary").orderByChild("saved").startAt(fromDate.getTime());
summaryRef.once("value", (snap) => {
    const val = snap.val();
    const summaries = toList(val).sort((a, b) => {
        return a.saved - b.saved;
    });
    console.log(summaries);
    renderMain(summaries);
});
