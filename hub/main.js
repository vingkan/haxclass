/* global db */

const isLocal = document.location.hostname === "localhost" && document.location.href.indexOf("l=false") == -1;
const HAXML_SERVER = isLocal ? "http://localhost:5000" : "https://haxml.herokuapp.com";

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
fetch("./summary_test_data.json").then(async (res) => {
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
    render() {
        const s = this.props.summary;
        const getId = (e) => {
            prompt("Match ID:", s.id);
        };
        const maxLineLength = 50;
        const urlReplay = `./replay.html?l=${this.props.isLocal}&m=${s.id}`;
        const urlJSON = `./json.html?l=${this.props.isLocal}&m=${s.id}`;
        const urlCSV = `./csv.html?l=${this.props.isLocal}&m=${s.id}`;
        const urlXG = `${HAXML_SERVER}/xgtimeplot/${s.id}.png`;
        const winner = s.scoreRed > s.scoreBlue ? "Red Won" : "Blue Won";
        const nPlayers = s.players.split(", ").length;
        const pluralPlayers = nPlayers === 1 ? "Player" : "Players";
        const playerString = `${nPlayers} ${pluralPlayers}: ${s.players}`;
        const sizeString = ` | ${getSizeString(s.size)}`;
        const stadiumString = limitChars(s.stadium, maxLineLength - sizeString.length);
        const metaString = `${stadiumString}${sizeString}`;
        return (
            <div className="Summary__Record">
                <div className="Summary__Half">
                    <div className="Summary__Score">{winner} {s.scoreRed} - {s.scoreBlue}</div>
                    <div className="Summary__Duration">{getDurationString(s.time)}</div>
                    <br />
                    <a className="Summary__ID Button__Round" onClick={getId}>ID</a>
                    <a className="Summary__Replay Button__Round" target="_blank" href={urlReplay}>Replay</a>
                    <a className="Summary__JSON Button__Round" target="_blank" href={urlJSON}>JSON</a>
                    <a className="Summary__CSV Button__Round" target="_blank" href={urlCSV}>CSV</a>
                    <a className="Summary__XG Button__Round" target="_blank" href={urlXG}>XG</a>
                </div>
                <div className="Summary__Half Summary__Right">
                    <div className="Summary__Date">{getDateString(s.saved)}</div>
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
            loading: false
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
                loading: false,
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
        const updateLimit = (e) => {
            if (e.target.value) {
                const limit = parseInt(e.target.value);
                if (!isNaN(limit)) {
                    component.setState({ limit });
                    component.listen(limit, component.state.listener);
                }
            }
        };
        const showMore = (e) => {
            const limit = component.state.limit + 5;
            component.setState({ limit });
            component.listen(limit, component.state.listener);
        };
        return (
            <div className="Main__Container">
                <h1>Recent Matches</h1>
                <div className="Main__Limit">
                    <div>
                        <span>{resultsString}</span>
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
            </div>
        );
    }
}

const defaultLimit = 10;
console.log(`Showing records from ${isLocal ? "local" : "Firebase"}.`);
const mainEl = <Main limit={defaultLimit} isLocal={isLocal} />
ReactDOM.render(mainEl, document.getElementById("main"));
