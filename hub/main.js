/* global db */

const isLocal = document.location.hostname === "localhost" && document.location.href.indexOf("l=false") == -1;

function listenForSummariesFromFirebase(limit, callback, prevListener) {
    const ref = db.ref("summary");
    const queryRef = ref.orderByChild("saved").limitToLast(limit);
    if (prevListener) {
        ref.off();
    }
    const listener = queryRef.on("value", (snap) => {
        const val = snap.val() || {};
        callback(val);
    });
    return listener;
}

let localVal;
let localKeys;
let isLocalReady = false;
const willFireLocalOnce = true;
fetch("../mock/summary_test_data.json").then(async (res) => {
    localVal = (await res.json()) || {};
    localKeys = Object.keys(localVal).sort((a, b) => {
        return localVal[b].saved - localVal[a].saved;
    });
    isLocalReady = true;
}).catch(console.error);

function listenForSummariesFromLocal(limit, callback, prevListener) {
    if (prevListener) {
        clearInterval(prevListener);
    };
    let i = 0;
    let isIncreasing = true;
    const interval = setInterval(() => {
        if (isLocalReady) {
            const loopLimit = Math.min(limit, localKeys.length);
            let sub = {};
            if (willFireLocalOnce) {
                for (let j = 0; j < loopLimit; j++) {
                    const key = localKeys[j];
                    if (key) {
                        sub[key] = localVal[key];    
                    }
                }
                callback(sub);
                clearInterval(interval);
            } else {
                i += (isIncreasing ? 1 : -1);
                if (i % loopLimit === 0) {
                    isIncreasing = !isIncreasing;
                }
                for (let j = 0; j < i; j++) {
                    const key = localKeys[j];
                    sub[key] = localVal[key];
                }
                callback(sub);                 
            }
        }
    }, 500);
    return interval;
}

function getDurationString(s) {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    const leftpadSecs = secs < 10 ? `0${secs}` : secs;
    return `${mins}:${leftpadSecs}`;
}

function getDateString(ts) {
    return new Date(ts).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        timeZoneName: "short"
    });
}

function getSizeString(b) {
    const kb = Math.floor(b / 1024);
    return `${kb} KB`;
}

function limitChars(s, c) {
    return s.length < c ? s : `${s.substr(0, c)}...`;
}

class Summary extends React.Component {
    constructor(props) {
        super(props);
    }
    componentDidMount() {
        const s = this.props.summary;
        const el = ReactDOM.findDOMNode(this);
        const btn = el.querySelector(".Summary__ID");
        const clip = new ClipboardJS(btn);
        clip.on("success", (e) => {
            btn.innerText = "Copied!";
            btn.classList.add("Copied");
            setTimeout(() => {
                btn.innerText = "ID";
                btn.classList.remove("Copied");
            }, 3000);
            e.clearSelection();
        });
        clip.on("error", (e) => {
            prompt("Match ID:", s.id);
        });
    }
    render() {
        const s = this.props.summary;
        const maxLineLength = 40;
        const urlReplay = `./replay.html?m=${s.id}${this.props.isLocal ? "&l=true" : ""}`;
        const urlJSON = `./json.html?m=${s.id}${this.props.isLocal ? "&l=true" : ""}`;
        const urlCSV = `./csv.html?m=${s.id}${this.props.isLocal ? "&l=true" : ""}`;
        const urlXG = `./xg.html?m=${s.id}${this.props.isLocal ? "&l=true" : ""}`;
        const winner = s.scoreRed > s.scoreBlue ? "Red Won" : "Blue Won";
        let allPlayers;
        if (s.playersRed || s.playersBlue) {
            const playersRed = s.playersRed ? s.playersRed.split(", ") : [];
            const playersBlue = s.playersBlue ? s.playersBlue.split(", ") : [];
            allPlayers = playersRed.concat(playersBlue)
        } else if (s.players) {
            allPlayers = s.players.split(", ");
        } else {
            allPlayers = [];
        }
        const nPlayers = allPlayers.length;
        const allPlayersStr = nPlayers > 0 ? allPlayers.join(", ") : "No player names found.";
        const pluralPlayers = nPlayers === 1 ? "Player" : "Players";
        const playerString = `${nPlayers} ${pluralPlayers}: ${allPlayersStr}`;
        const sizeString = ` | ${getSizeString(s.size)}`;
        const stadiumString = limitChars(s.stadium, maxLineLength - sizeString.length);
        const metaString = `${stadiumString}${sizeString}`;
        return (
            <div className="Summary__Record">
                <div className="Summary__Half">
                    <h3>
                        <span className="Summary__Score">{winner} {s.scoreRed} - {s.scoreBlue}</span>
                        <span className="Summary__Duration">{getDurationString(s.time)}</span>
                    </h3>
                    <a className="Summary__ID Button__Round" data-clipboard-text={s.id}>ID</a>
                    <a className="Summary__Replay Button__Round" target="_blank" href={urlReplay}>Replay</a>
                    <a className="Summary__JSON Button__Round" target="_blank" href={urlJSON}>JSON</a>
                    <a className="Summary__CSV Button__Round" target="_blank" href={urlCSV}>CSV</a>
                    <a className="Summary__XG Button__Round" target="_blank" href={urlXG}>XG</a>
                </div>
                <div className="Summary__Half Summary__Right">
                    <h3>
                        <div className="Summary__Date">{getDateString(s.saved)}</div>
                    </h3>
                    <div className="Summary__Players">{limitChars(playerString, maxLineLength)}</div>
                    <div className="Summary__Meta">{metaString}</div>
                </div>
            </div>
        );
    }
}

class RecentMatches extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        const summaryMap = this.props.summaries;
        const summaryKeys = Object.keys(summaryMap);
        const records = summaryKeys.map((key) => {
            return summaryMap[key];
        }).sort((a, b) => {
            return b.saved - a.saved;
        });
        return (
            <div>
                <div>
                    {records.map((s) => {
                        return (
                            <Summary
                                key={s.id}
                                summary={s}
                                isLocal={this.props.isLocal}
                            />
                        );
                    })}
                </div>
            </div>
        );
    }
}

class Main extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            limit: props.limit || 5,
            summaries: {},
            listener: null,
            loading: false,
            matchID: "",
            match: null,
            searching: false
        };
    }
    componentDidMount() {
        this.listen(this.state.limit, this.state.listener);
    }
    listen(limit, prevListener) {
        const component = this;
        component.setState({ loading: true });
        const replaceListener =
            this.props.isLocal
                ? listenForSummariesFromLocal
                : listenForSummariesFromFirebase;
        const newListener = replaceListener(limit, (val) => {
            component.setState({
                summaries: val,
                listener: newListener,
                loading: false
            });
        }, prevListener);
    }
    render() {
        const component = this;
        const summaryMap = this.state.summaries;
        const summaryKeys = Object.keys(summaryMap);
        const nSummaries = summaryKeys.length;
        const pluralSummaries = nSummaries === 1 ? "recent match" : "recent matches";
        const recordsSource = this.props.isLocal ? "local records" : "database records";
        const resultsString = `Showing ${nSummaries} ${pluralSummaries} from ${recordsSource}.`;
        const hasMatchID = this.state.matchID && this.state.matchID.length > 0;
        let matchEl;
        if (hasMatchID) {
            if (this.state.match) {
                const matchMap = { [this.state.matchID]: this.state.match };
                matchEl = <RecentMatches isLocal={this.props.isLocal} summaries={matchMap} />;
            } else if (this.state.searching) {
                matchEl = <p>Searching...</p>;
            } else {
                matchEl = <p>No match summary found for ID: {this.state.matchID}</p>;
            }         
        }
        const updateLimit = (e) => {
            if (e.target.value) {
                const limit = parseInt(e.target.value);
                if (!isNaN(limit)) {
                    component.setState({ limit });
                    component.listen(limit, component.state.listener);
                }
            }
        };
        const updateSearch = (e) => {
            const matchID = e.target.value;
            if (matchID.length > 0) {
                component.setState({ matchID, match: null, searching: true });
                db.ref(`summary/${matchID}`).once("value", (snap) => {
                    const match = snap.val();
                    component.setState({ matchID, match, searching: false });
                });
            } else {
                component.setState({ matchID, match: null, searching: false });
            }
        };
        const showMore = (e) => {
            const limit = component.state.limit + 5;
            component.setState({ limit });
            component.listen(limit, component.state.listener);
        };
        return (
            <div className="Main__Container">
                <section>
                    <h1>HaxClass Hub</h1>
                </section>
                <section className="Main__Nav">
                    <h2>View Analytics</h2>
                    <a className="Button__Round Nav__Live" href="./live.html">Live Stats</a>
                    <a className="Button__Round Nav__Leaderboard" href="./leaderboard.html">Leaderboard</a>
                    <a className="Button__Round Nav__Player" href="./player.html">Player Comparison</a>
                    <a className="Button__Round Nav__Download" href="./download.html">Download Data</a>
                    <a className="Button__Round Nav__XG" href="./xg.html">XG</a>
                </section>
                <section className="Main__Search">
                    <h2>Find Match By ID</h2>
                    <input
                        type="text"
                        placeholder="Match ID"
                        onChange={updateSearch}
                    />
                    {matchEl}
                </section>
                <section className="Main__Recent">
                    <h2>Recent Matches</h2>
                    <div className="Main__Limit">
                        <div>
                            <p>{resultsString}</p>
                        </div>
                        <div>
                            <span>Limit</span>
                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={this.state.limit}
                                onChange={updateLimit}
                            />
                        </div>
                    </div>
                    <p>{this.state.loading ? "Loading..." : ""}</p>
                    <RecentMatches
                        isLocal={this.props.isLocal}
                        summaries={summaryMap}
                    />
                    <div className="Main__ShowMore">
                        <button className="Button__Round" onClick={showMore}>Show More</button>
                        <p>{resultsString}</p>
                    </div>
                </section>
            </div>
        );
    }
}

const defaultLimit = 10;
console.log(`Showing records from ${isLocal ? "local" : "Firebase"}.`);
const mainEl = <Main limit={defaultLimit} isLocal={isLocal} />
ReactDOM.render(mainEl, document.getElementById("main"));
