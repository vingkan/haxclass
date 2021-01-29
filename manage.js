const dotenv = require("dotenv");
const firebase = require("firebase-admin");
const fs = require("fs");

dotenv.config();

const serviceAccount = {
    type: process.env.FIREBASE_CREDENTIAL_type,
    project_id: process.env.FIREBASE_CREDENTIAL_project_id,
    private_key_id: process.env.FIREBASE_CREDENTIAL_private_key_id,
    private_key: process.env.FIREBASE_CREDENTIAL_private_key.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CREDENTIAL_client_email,
    client_id: process.env.FIREBASE_CREDENTIAL_client_id,
    auth_uri: process.env.FIREBASE_CREDENTIAL_auth_uri,
    token_uri: process.env.FIREBASE_CREDENTIAL_token_uri,
    auth_provider_x509_cert_url: process.env.FIREBASE_CREDENTIAL_auth_provider_x509_cert_url,
    client_x509_cert_url: process.env.FIREBASE_CREDENTIAL_client_x509_cert_url
};

const firebaseConfig = {
    credential: firebase.credential.cert(serviceAccount),
    apiKey: process.env.FIREBASE_SECRET_apiKey,
    authDomain: process.env.FIREBASE_SECRET_authDomain,
    databaseURL: process.env.FIREBASE_SECRET_databaseURL,
    projectId: process.env.FIREBASE_SECRET_projectId,
    storageBucket: process.env.FIREBASE_SECRET_storageBucket,
    messagingSenderId: process.env.FIREBASE_SECRET_messagingSenderId,
    appId: process.env.FIREBASE_SECRET_appId
};

firebase.initializeApp(firebaseConfig);

const db = firebase.database();

if (process.argv.length < 3) {
    console.log("No script selected.");
    process.exit(0);
}

const script = process.argv[2];
console.log(`Running Script: ${script}`);

if (script === "delete") {
    // Paste match IDs to delete, separated by newlines.
    const toDelete = `
    
    `.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (toDelete.length < 1) {
        console.log("No matches specified for deletion.");
        process.exit(0);
    }

    const promises = [];
    for (let i = 0; i < toDelete.length; i++) {
        const mid = toDelete[i];
        const mp = db.ref(`match/${mid}`).remove();
        const sp = db.ref(`summary/${mid}`).remove();
        const kp = new Promise((resolve, reject) => {
            const kickRefs = db.ref("kick").orderByChild("match").equalTo(mid);
            kickRefs.once("value", (snap) => {
                let subPromises = [];
                snap.forEach((data) => {
                    const skp = db.ref(`kick/${data.key}`).remove();
                    subPromises.push(skp);
                });
                console.log(`Deleting ${subPromises.length} kicks for match: ${mid}`);
                Promise.all(subPromises).then(resolve).catch(reject);
            });
        });
        promises.push(mp);
        promises.push(sp);
        promises.push(kp);
    }
    Promise.all(promises).then((done) => {
        console.log(`Successfully deleted ${promises.length} records.`);
        process.exit(0);
    }).catch((err) => {
        console.log(`Error while deleting records:`);
        console.log(err);
        process.exit(0);
    });
}

if (script === "download_summaries") {
    const limit = 20;
    const ref = db.ref("summary");
    const queryRef = ref.orderByChild("saved").limitToLast(limit);
    const listener = queryRef.once("value", (snap) => {
        const val = snap.val() || {};
        const testData = JSON.stringify(val, null, 2);
        const n = Object.keys(val).length;
        fs.writeFileSync("./mock/summary_test_data.json", testData);
        console.log(`Successfully downloaded ${n} summaries.`);
        process.exit(0);
    });
}

if (script === "download_player") {
    if (process.argv.length < 4) {
        console.log("No player name specified.");
        process.exit(0);
    }
    const playerName = process.argv[3];
    const fromRef = db.ref("kick").orderByChild("fromName").equalTo(playerName);
    const toRef = db.ref("kick").orderByChild("toName").equalTo(playerName);
    const saveQuery = (ref, type) => {
        return new Promise((resolve, reject) => {
            ref.once("value", (snap) => {
                const val = snap.val() || {};
                const n = Object.keys(val).length;
                const data = JSON.stringify(val, null, 2);
                fs.writeFileSync(`./mock/player_test_data_kicks_${type}_${playerName}.json`, data);
                resolve(`Successfully downloaded ${n} kicks ${type} ${playerName}.`);
            }).catch((err) => {
                resolve(`Failed to download kicks ${type} ${playerName}.`);
            });
        });
    };
    const promises = [
        saveQuery(fromRef, "from"),
        saveQuery(toRef, "to"),
    ];
    Promise.all(promises).then((messages) => {
        messages.forEach((msg) => console.log(msg));
        process.exit(0);
    }).catch((err) => {
        console.log("Error while downloading player kicks:");
        console.log(err);
        process.exit(0);
    });
}

if (script === "elo") {
    let nMatches = 50;
    let stadium = "NAFL Official Map v1";
    if (process.argv.length > 3) {
        const nMatchesArg = process.argv[3];
        if (!isNaN(nMatchesArg)) {
            nMatches = parseInt(nMatchesArg);
        }
    }
    if (process.argv.length > 4) {
        stadium = process.argv[4];
    }
    const ref = db.ref("summary").orderByChild("stadium").equalTo(stadium).limitToLast(nMatches);
    ref.once("value", (snap) => {
        const val = snap.val();
        Object.keys(val).map((k) => {
            return val[k];
        }).sort((a, b) => {
            return a.saved - b.saved;
        }).map((m) => {
            return [
                m.playersRed,
                m.playersBlue,
                m.scoreRed || 0,
                m.scoreBlue || 0,
            ].join("\t");
        }).forEach((line) => {
            console.log(line);
        });
        process.exit(0);
    });
}

if (script === "leaderboard") {
    const HOUR_MS = 60 * 60 * 1000
    const fromTime = Date.now() - (6 * HOUR_MS);
    let since = fromTime;
    let until = Date.now();
    if (process.argv.length > 3) {
        const timeStr = process.argv[3];
        since = new Date(timeStr).getTime();
        until = since + (6 * HOUR_MS);
    }
    const summaryRef = db.ref("summary").orderByChild("saved").startAt(since).endAt(until);
    summaryRef.once("value", (snap) => {
        const val = snap.val();
        if (val) {
            const data = JSON.stringify(val, null, 2);
            fs.writeFileSync(`./mock/leaderboard_recent_summaries.json`, data);
            console.log(`Saved ${Object.keys(val).length} matches.`);
            process.exit(0);
        } else {
            console.log(`No matches found six hours after the given time.`);
            process.exit(0);
        }
    });
}
