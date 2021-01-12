const isLocal = document.location.hostname === "localhost" && document.location.href.indexOf("l=false") == -1;
const HAXML_SERVER = isLocal ? "http://localhost:5000" : "https://haxml.herokuapp.com";

function styleTeamCell(k) {
    return {
        color: `rgb(${TEAM_RGB[k.team]})`,
    };
}

function styleXGCell(k) {
    return {
        background: `rgba(${FUTSAL_RGB}, ${k.xgScore})`,
    };
}

function tableXG(match, modelName, selectedKick, onView) {
    const headers = [
        { key: "name", name: "Player" },
        { key: "team", name: "Team", style: styleTeamCell },
        { key: "timeSecs", name: "Time" },
        { key: "timeClock", name: "Clock" },
        { key: "xgDisplay", name: "XG", style: styleXGCell },
        { key: "type", name: "Result" },
        { key: "model", name: "Model" },
        { key: "view", name: "View" },
    ];
    const kicks = match ? match.kicks : [];
    const classes = "Button__Round ViewShot";
    const rows = kicks.map((k, i) => {
        const isSelected = i === selectedKick;
        const btn = (
            <button
                className={`${classes}${isSelected ? " SelectedKick" : ""}`}
                onClick={() => {
                    onView(match, k, i);
                }}
            >{isSelected ? "Displayed" : "View"}</button>
        );
        return {
            name: limitChars(k.fromName, 20),
            team: k.fromTeam,
            type: k.type,
            time: k.time,
            timeSecs: k.time.toFixed(1),
            timeClock: toClock(k.time),
            xgScore: k.xg,
            xgDisplay: k.xg.toFixed(3),
            model: modelName,
            view: btn,
        }
    }).sort((a, b) => {
        return a.time - b.time;
    });
    return { headers, rows };
}

function getPositionsForTimeRange(positions, start, end) {
    return positions.filter((p) => {
        return p.time >= start && p.time <= end;
    });
}

function getFieldChildren(match, stadium, k) {
    let fieldChildren = [];
    if (match && stadium) {
        const offset = 2;
        const startTime = k.time - offset;
        const endTime = k.time;
        const positions = getPositionsForTimeRange(match.positions, startTime, endTime);
        const { toX, toY } = makeXAndY(stadium);
        let lastPos = {};
        positions.forEach((p) => {
            let childEl;
            const alpha = getAlpha(p.time, startTime, endTime);
            if (p.type === "player") {
                lastPos[p.name] = p;
                childEl = (
                    <circle
                        className="player"
                        cx={toX(p.x)}
                        cy={toY(p.y)}
                        r={PLAYER_RADIUS}
                        fill={`rgba(${TEAM_RGB[p.team]}, ${alpha})`}
                    />
                );
            } else {
                childEl = (
                    <circle
                        className="ball-alpha"
                        cx={toX(p.x)}
                        cy={toY(p.y)}
                        r={stadium.ball.radius}
                        fill={`rgba(${FUTSAL_RGB}, ${alpha})`}
                    />
                );
            }
            fieldChildren.push(childEl);
        });
        toList(lastPos).forEach((p) => {
            const textEl = (
                <text
                    className="username"
                    x={toX(p.x)}
                    y={toY(p.y)}
                    dy={(7 / 3) * PLAYER_RADIUS}
                    fontSize={(4 / 3) * PLAYER_RADIUS}
                >{p.name}</text>
            );
            fieldChildren.push(textEl);
        });
    }
    return fieldChildren;
}

class XGMain extends React.Component {
    constructor(props) {
        super(props);
        const stadiums = props.stadiums || {};
        const data = props.data || {};
        const match = data.match || null;
        const stadium = match ? stadiums[match.stadium] || {} : {};
        const firstKick = match ? match.kicks[0] : null;
        const firstKickChildren = getFieldChildren(match, stadium, firstKick);
        this.state = {
            isLoading: props.stadiums ? false : true,
            mid: props.mid ? props.mid : null,
            model: props.model ? props.model : null,
            view: "field",
            selectedKick: 0,
            fieldChildren: firstKickChildren,
        };
    }
    render() {
        const component = this;
        const isLoading = this.state.isLoading;
        const stadiums = this.props.stadiums || {};
        const data = this.props.data || {};
        const match = data.match || null;
        const stadium = match ? stadiums[match.stadium] || {} : {};
        const stadiumName = match ? match.stadium : "No Stadium Selected";
        const viewShot = (m, k, i) => {
            const fieldChildren = getFieldChildren(match, stadium, k);
            component.setState({ fieldChildren, selectedKick: i, view: "field" });
        }
        const setView = (viewName) => { 
            return (e) => {
                component.setState({ view: viewName });
            };
        };
        const xgTable = tableXG(match, this.props.model, this.state.selectedKick, viewShot);
        const showField = this.state.view === "field" ? "block" : "none";
        const showTimePlot = this.state.view === "timeplot" ? "block" : "none";
        let timePlotEl;
        if (data.mid) {
            const plotURL = `${HAXML_SERVER}/xgtimeplot/${this.props.mid}.png?clf=${this.props.model}`;
            timePlotEl = <img src={plotURL} />;
        }
        let problemEl;
        let problemMsg;
        if (this.props.problem) {
            problemMsg = this.props.problem;
        }
        if (problemMsg) {
            problemEl = <p>{problemMsg}</p>;
        }
        return (
            <div className={`MainContainer XG ${isLoading ? "Loading" : ""}`}>
                <div className="Loader">
                    <div class="lds"><div></div><div></div><div></div></div>
                </div>
                <section>
                    <h1>Expected Goals (XG)</h1>
                    <div className="XGPicker Picker">
                        <span className="Stadium TextOnly">
                            <span className="Label Bold">Stadium: </span>
                            {stadiumName}
                        </span>
                        <span className="Model">
                            <span className="Label Bold">Model: </span>
                            <input
                                type="text"
                                placeholder="Model (Optional)"
                                value={this.state.model}
                                onChange={(e) => {
                                    const model = e.target.value;
                                    component.setState({ model });
                                }}
                                onKeyPress={(e) => {
                                    const code = e.keyCode ? e.keyCode : e.which;
                                    if (code === 13) {
                                        const model = e.target.value;
                                        component.setState({ isLoading: true });
                                        component.props.loadMatchXG(component.state.mid, model);
                                    }
                                }}
                            />
                        </span>
                        <span className="Match">
                            <span className="Label Bold">Match: </span>
                            <input
                                type="text"
                                placeholder="Match ID"
                                value={this.state.mid}
                                onChange={(e) => {
                                    const mid = e.target.value;
                                    component.setState({ mid });
                                }}
                                onKeyPress={(e) => {
                                    const code = e.keyCode ? e.keyCode : e.which;
                                    if (code === 13) {
                                        const mid = e.target.value;
                                        component.setState({ isLoading: true });
                                        component.props.loadMatchXG(mid, component.state.model);
                                    }
                                }}
                            />
                        </span>
                    </div>
                    {problemEl}
                    <div className="ViewPicker">
                        <a className="Button__Round BtnField" onClick={setView("field")}>
                            View Field
                        </a>
                        <a className="Button__Round BtnTimePlot" onClick={setView("timeplot")}>
                            View Time Plot
                        </a>
                        <a
                            className="Button__Round BtnReplay"
                            href={`./replay.html?m=${this.props.mid}${isLocal ? "&l=true" : ""}`}
                            target="_blank"
                        >Open Replay</a>
                    </div>
                    <Field stadium={stadium} kicks={[]} style={{display: showField}}>
                        {this.state.fieldChildren}
                    </Field>
                    <div className="TimePlot" style={{display: showTimePlot}}>
                        {timePlotEl}
                    </div>
                    <StatsTable table={xgTable} />
                </section>
            </div>
        );
    }
}

const url = document.location.href;
let matchID = getParam(url, "m");
let clf = getParam(url, "clf");
let allStadiums = null;

function renderMain(data, stadiums, problem=null) {
    const mainEl = document.getElementById("main");
    const mainRe = (
        <XGMain
            mid={data ? data.mid : matchID}
            model={data ? data.model_name : clf}
            data={data}
            stadiums={stadiums}
            loadMatchXG={loadMatchXG}
            problem={problem}
        />
    );
    ReactDOM.unmountComponentAtNode(mainEl);
    ReactDOM.render(mainRe, mainEl);
}

function loadMatchXG(mid, model) {
    matchID = mid;
    clf = model;
    if (matchID) {
        fetch(`${HAXML_SERVER}/xg/${matchID}${clf ? `?clf=${clf}` : ""}`).then(async (res) => {
            const data = await res.json();
            if (data.success) {
                clf = data.model_name;
                renderMain(data, allStadiums);    
            } else {
                renderMain(null, allStadiums, data.message);
            }
        }).catch((err) => {
            const problemMsg = `Failed to reach XG server with match ID ("${matchID}").`;
            renderMain(null, allStadiums, problemMsg);
            console.log(problemMsg);
            console.error(err);
        });
    } else {
        const problemMsg = "Please enter a match ID.";
        renderMain(null, allStadiums, problemMsg);
    }
}

// Wake up the HaxML server.
fetch(`${HAXML_SERVER}/hello`);
renderMain(null, null);
loadStadiumData().then((stadiums) => {
    allStadiums = stadiums;
    loadMatchXG(matchID, clf);
}).catch((err) => {
    console.log("Error loading stadium data:");
    console.error(err);
});
