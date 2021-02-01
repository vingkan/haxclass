/* Utility Methods */

const FUTSAL_RGB = `127, 227, 84`;
const TEAM_RGB = {
    "red": `217, 3, 104`,
    "blue": `63, 167, 214`,
};

function getParam(url, tag) {
    if (url.indexOf(`${tag}=`) > -1) {
        return url.split(`${tag}=`)[1].split("&")[0];
    }
    return null;
}

function maybeParseFloat(val) {
    if (!isNaN(val)) {
        return parseFloat(val);
    }
    const per = val.split("%")[0];
    if (!isNaN(per)) {
        return parseFloat(per);
    } else {
        return isNaN(val) ? val : parseFloat(val);
    }
}

function toPct(num, den) {
    if (den > 0) {
        const frac = num / den;
        const pct = 100 * frac;
        return `${pct.toFixed(1)}%`; 
    } else {
        return `0.0%`;
    }
}

function toRatio(num, den, digits=4) {
    if (num === 0) {
        return `0.00`;
    } else if (den > 0) {
        const frac = num / den;
        const before = `${frac}`.split(".")[0].length;
        return `${frac.toFixed(digits - before)}`;
    } else {
        return `∞`;
    }
}

function div(num, den, d=3) {
    if (Math.abs(den) > 0) {
        return (num / den).toFixed(d);
    }
    return (0).toFixed(d);
}

function plur(n, s, p) {
    const ps = p ? p : `${s}s`;
    return n === 1 ? `${n} ${s}` : `${n} ${ps}`;
}

function firstCap(s) {
    if (s.length > 0) {
        const f = s.substr(0, 1).toUpperCase();
        return `${f}${s.substr(1)}`;
    } else {
        return s;
    }
}

function leftpad(val) {
    return val < 10 ? `0${val}` : `${val}`;
}

function toClock(secs) {
    const s = Math.floor(secs);
    return `${leftpad(Math.floor(s / 60))}:${leftpad(s % 60)}`;
}

function limitChars(s, c) {
    return s.length < c ? s : `${s.substr(0, c)}...`;
}

function toList(map) {
    return Object.keys(map).map((k) => map[k]);
}

function getAlpha(val, minVal, maxVal, minAlpha=0.1, maxAlpha=0.9) {
    if (val < minVal) {
        return minAlpha;
    } else if (val > maxVal) {
        return maxAlpha;
    } else {
        const valFrac = (val - minVal) / (maxVal - minVal);
        return minAlpha + (valFrac * (maxAlpha - minAlpha));
    }
}

function formatMatchTimeString(saved) {
    return new Date(saved).toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "numeric",
    }).split(", ").join(" ");
}

function formatCompactMatchTimeString(saved) {
    return new Date(saved).toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
    }).split(", ").join(" ");
}

function formatMatchTimeOnlyString(saved) {
    return new Date(saved).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "numeric",
    });
}

/* Stadium and Field */

const TEAMS = { 1: "red", 2: "blue", "1": "red", "2": "blue", Red: 1, Blue: 2 };
const PLAYER_RADIUS = 15;
const GOAL_AREA_RADIUS = 1.5;

function parseStadiumDataMap(data) {
    return data.reduce((agg, val) => {
        const sizeX = val.bounds.maxX - val.bounds.minX;
        const sizeY = val.bounds.maxY - val.bounds.minY;
        const midX = (sizeX / 2) + val.bounds.minX;
        const midY = (sizeY / 2) + val.bounds.minY;
        agg[val.stadium] = {
            ...val,
            field: { sizeX, sizeY, midX, midY, },
        };
        return agg;
    }, {});
}

async function loadStadiumData() {
    const stadiumRes = await fetch(`../stadium/map_data.json`).catch(console.error);
    const stadiumDataMap = parseStadiumDataMap(await stadiumRes.json());
    return stadiumDataMap;
}

function makeXAndY(stadium) {
    const toX = (x) => {
        return x - stadium.bounds.minX;
    };
    const toY = (y) => {
        return y - stadium.bounds.minY;
    };
    return { toX, toY };
}

function makeArcPath(props) {
    const { x1, y1, x2, y2, sweep } = props;
    const d = `M ${x1} ${y1} A 1 1, 0, 0 ${sweep}, ${x2} ${y2}`;
    return d;
}

function Field(props) {
    const s = props.stadium;
    const hasStadium = Object.keys(s).length > 0;
    if (!hasStadium) {
        return (
            <p>No stadium data to show.</p>
        );
    }
    const hasGoalPosts = s.goalposts[TEAMS.Red] && s.goalposts[TEAMS.Blue];
    if (!hasGoalPosts) {
        return (
            <p>No goalposts found for this stadium.</p>
        );
    }
    const kicks = props.kicks;
    const toX = (x) => {
        return x - s.bounds.minX;
    };
    const toY = (y) => {
        return y - s.bounds.minY;
    };
    const viewBoxDim = `0 0 ${s.field.sizeX} ${s.field.sizeY}`;
    const gpRed = s.goalposts[TEAMS.Red];
    const gpBlue = s.goalposts[TEAMS.Blue];
    const goalAreaRadius = GOAL_AREA_RADIUS * gpRed.size / 2;
    const goalposts = [ ...gpRed.posts, ...gpBlue.posts, ];
    const goalCoordsRed = {
        x1: toX(goalposts[0].x),
        y1: toY(gpRed.mid.y - goalAreaRadius),
        x2: toX(goalposts[1].x),
        y2: toY(gpRed.mid.y + goalAreaRadius),
    };
    const goalCoordsBlue = {
        x1: toX(goalposts[2].x),
        y1: toY(gpBlue.mid.y - goalAreaRadius),
        x2: toX(goalposts[3].x),
        y2: toY(gpBlue.mid.y + goalAreaRadius),
    };
    const goalLines = [goalCoordsBlue, goalCoordsRed];
    return (
        <div className="Field" style={props.style}>
            <svg viewBox={viewBoxDim} xmlns="http://www.w3.org/2000/svg">
                <rect
                    className="field-pitch"
                    width={s.field.sizeX}
                    height={s.field.sizeY}
                />
                <line
                    className="field-line"
                    x1={toX(s.field.midX)}
                    y1={toY(s.bounds.minY)}
                    x2={toX(s.field.midX)}
                    y2={toY(s.bounds.maxY)}
                />
                {goalposts.map(({ x, y }) => {
                    return (
                        <circle
                            cx={toX(x)}
                            cy={toY(y)}
                            r={5}
                            fill="white"
                        />
                    );
                })}
                {goalLines.map((goalCoords, sweep) => {
                    return (
                        <line
                            className="field-line"
                            x1={goalCoords.x1}
                            x2={goalCoords.x2}
                            y1={toY(s.bounds.minY)}
                            y2={toY(s.bounds.maxY)}
                        />
                    );
                })}
                {goalLines.map((goalCoords, sweep) => {
                    return (
                        <path
                            className="field-line dashed"
                            d={makeArcPath({ ...goalCoords, sweep })}
                            fill="none"
                        />
                    );
                })}
                {kicks.map((kick) => {
                    return (
                        <circle
                            className={`player`}
                            cx={toX(kick.fromX)}
                            cy={toY(kick.fromY)}
                            r={5}
                            fill={kick.color}
                        />
                    );
                })}
                {kicks.map((kick) => {
                    return (
                        <line
                            className={`shot goal`}
                            x1={toX(kick.fromX)}
                            y1={toY(kick.fromY)}
                            x2={toX(kick.toX)}
                            y2={toY(kick.toY)}
                            stroke={kick.color}
                        />
                    );
                })}
                {React.Children.map(props.children, (el) => el)}
            </svg>
        </div>
    );
}

/* Tables */

function StatsTable(props) {
    const { headers, rows } = props.table;
    const initialSearch = props.initialSearch ? `${props.initialSearch}` : "";
    const [sortCol, setSortCol] = React.useState(null);
    const [sortAsc, setSortAsc] = React.useState(false);
    const [search, setSearch] = React.useState(initialSearch);
    const showTitle = props.title || props.isSearchable;
    const sortBy = (col) => {
        return (e) => {
            if (col !== sortCol) {
                // New sort column, default to descending order.
                setSortCol(col);
                setSortAsc(false);
            } else {
                // Same sort column, just change sort order.
                // Cycle between: false -> true -> null -> false.
                if (sortAsc === false) {
                    setSortAsc(true);
                } else if (sortAsc) {
                    setSortCol(null);
                    setSortAsc(false);
                } else {
                    setSortAsc(false);
                }
            }
        };
    }
    const getCells = (p) => {
        return headers.map((col) => {
            let style = {};
            if (col.style) {
                style = col.style(p);
            }
            return (
                <td style={style}>
                    {p[col.key]}
                </td>
            );
        });
    };
    const getRow = (p, i) => {
        return <tr key={i}>{getCells(p)}</tr>;
    };
    let displayRows = [ ...rows ];
    if (search.length > 0) {
        const terms = search.toLowerCase().split(",").map((l) => l.trim()).filter((l) => l.length > 0);
        const isSingleTermMatch = (rowText) => {
            return rowText.indexOf(search) > -1;
        };
        const isMultiTermMatch = (rowText) => {
            for (let j = 0; j < terms.length; j++) {
                if (rowText.indexOf(terms[j]) > -1) {
                    return true;
                }
            }
            return false;
        };
        let isMatch = isSingleTermMatch;
        if (props.hasMultiTermSearch) {
            isMatch = isMultiTermMatch;
        }
        displayRows = displayRows.filter((p) => {
            const rowText = headers.map((col) => {
                return p[col.key];
            }).join(" ").toLowerCase().trim();
            return isMatch(rowText);
        });
    }
    if (sortCol !== null) {
        displayRows = displayRows.sort((a, b) => {
            // Return 1 if aVal should be further down the list.
            const aVal = maybeParseFloat(a[sortCol]);
            const bVal = maybeParseFloat(b[sortCol]);
            // Put numerical values at the top of the list.
            if (isNaN(aVal) && !isNaN(bVal)) {
                return 1;
            } else if (!isNaN(aVal) && isNaN(bVal)) {
                return -1;
            } else if (sortAsc) {
                return aVal > bVal ? 1 : -1;
            } else {
                return aVal < bVal ? 1 : -1;
            }
        });
    }
    return (
        <div className="StatsTable Full">
            <div className="Picker TitleAndSearch" style={{display: showTitle ? "flex" : "none"}}>
                <span className="Label Bold Title">{props.title}</span>
                <span className="Sub">
                    <input
                        type="text"
                        placeholder="Search"
                        value={search}
                        onChange={(e) => {
                            const value = e.target.value.toLowerCase();
                            setSearch(value);
                        }}
                        style={{
                            display: props.isSearchable ? "inline-block" : "none",
                            width: props.searchWidth || "auto",
                        }}
                    />
                </span>
            </div>
            <div className="TableHolder">
                <table>
                    <thead>
                        {headers.map((col) => {
                            const isSorted = col.key === sortCol;
                            let classNames = [];
                            let arrow;
                            if (isSorted) {
                                classNames.push("Sorted");
                                arrow = (
                                    <span className="SortArrow">{sortAsc ? "▼" : "▲"}</span>
                                );
                            }
                            let desc;
                            if (col.desc) {
                                classNames.push("HasDescription")
                                desc = (
                                    <span className="Description">{col.desc}</span>
                                );
                            }
                            return (
                                <th className={classNames.join(" ")} onClick={sortBy(col.key)}>
                                    {col.name}{arrow}{desc}
                                </th>
                            );
                        })}
                    </thead>
                    <tbody>
                        {displayRows.map(getRow)}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
