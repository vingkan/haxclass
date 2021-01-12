const LOCAL_DELAY = 0;

let allTimeKickMap = {};
let allMatchMap = {};

function combineKicks(kickRes) {
    let kicks = [];
    Object.keys(kickRes.to).forEach((k) => {
        kicks.push({ ...kickRes.to[k], kick: k, direction: "to" });
    });
    Object.keys(kickRes.from).forEach((k) => {
        kicks.push({ ...kickRes.from[k], kick: k, direction: "from" });
    });
    return kicks;
}

function fetchPlayerKicksFromFirebase(playerName) {
    return new Promise((resolveAll, rejectAll) => {
        const isCached = playerName in allTimeKickMap;
        if (isCached) {
            console.log(`Using cached data for: ${playerName}.`);
            resolveAll(allTimeKickMap[playerName]);
        } else {
            console.log(`Sending new Firebase query for: ${playerName}.`);
            const fromRef = db.ref("kick").orderByChild("fromName").equalTo(playerName);
            const toRef = db.ref("kick").orderByChild("toName").equalTo(playerName);
            const getQuery = (ref, type) => {
                return new Promise((resolve, reject) => {
                    ref.once("value", (snap) => {
                        const kicks = snap.val() || {};
                        resolve({
                            success: true,
                            playerName,
                            type,
                            kicks,
                        });
                    }).catch(reject);
                });
            };
            const promises = [
                getQuery(fromRef, "from"),
                getQuery(toRef, "to"),
            ];
            Promise.all(promises).then((results) => {
                const res = results.reduce((agg, val) => {
                    const { type, kicks } = val;
                    agg["playerName"] = playerName;
                    agg[type] = kicks;
                    return agg;
                }, {});
                const allKicks = combineKicks(res);
                if (allKicks.length === 0) {
                    rejectAll(`No kicks found for player: ${playerName}`);
                } else {
                    const matchPromises = Object.keys(allKicks.reduce((agg, kick) => {
                        agg[kick.match] = true;
                        return agg;
                    }, {})).filter((matchID) => !(matchID in allMatchMap)).map((matchID) => {
                        return new Promise((resolveMatch, rejectMatch) => {
                            // db.ref(`match/${matchID}/score`).once("value", (snap) => {
                            db.ref(`summary/${matchID}`).once("value", (snap) => {
                                const scoreVal = snap.val() || {};
                                allMatchMap[matchID] = scoreVal;
                                resolveMatch(true);
                            }).catch((err) => {
                                console.log(`Error while fetching score for match: ${matchID}`);
                                console.error(err);
                                resolveMatch(false);
                            });
                        });
                    });
                    Promise.all(matchPromises).then((done) => {
                        resolveAll(res);
                    }).catch((err) => {
                        console.log("Error while fetching scores for matches.");
                        console.error(err);
                        resolveAll(res);
                    });
                }
            }).catch(rejectAll);            
        }
    });
}

function fetchPlayerKicksFromLocal(playerName) {
    return new Promise((resolveAll, rejectAll) => {
        const getQuery = async (type) => {
            await new Promise((resolve, reject) => {
                setTimeout(resolve, LOCAL_DELAY);
            });
            const res = await fetch(`../mock/player_test_data_kicks_${type}_${playerName}.json`);
            const kicks = await res.json();
            return {
                success: true,
                playerName,
                type,
                kicks,
            };
        };
        const promises = [
            getQuery("from"),
            getQuery("to"),
        ];
        Promise.all(promises).then((results) => {
            const res = results.reduce((agg, val) => {
                const { type, kicks } = val;
                agg["playerName"] = playerName;
                agg[type] = kicks;
                return agg;
            }, {});
            resolveAll(res);
        }).catch(rejectAll);
    });
}
