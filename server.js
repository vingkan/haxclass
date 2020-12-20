const dotenv = require("dotenv");
const firebase = require("firebase-admin");
const fs = require("fs");
const puppeteer = require("puppeteer");

if (process.argv.length < 3) {
    console.log("Missing config file argument.");
    process.exit();
}

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

const STADIUMS = {
    "NAFL 1v1/2v2 Map v1": "nafl_12",
    "NAFL Official Map v1": "nafl_34",
};

const configFile = process.argv[2];
const rawRoomConfig = fs.readFileSync(configFile).toString();
const roomConfig = JSON.parse(rawRoomConfig);

const TOKEN = process.argv.length >= 4 ? process.argv[3] : roomConfig.token;

if (!TOKEN) {
    console.log("Missing token for HaxBall Headless API.");
    process.exit();
}

function setWindowVariables(page) {
    const config = { ...roomConfig, token: TOKEN };
    return page.evaluateOnNewDocument(`
        Object.defineProperty(window, "RAW_CONFIG", {
            get() {
                return '${JSON.stringify(config)}';
            }
        });
    `);
}

/*
 * Estimate size of JSON data:
 * https://hashnode.com/post/what-is-the-best-way-to-calculate-the-size-of-a-json-object-in-nodejs-cinklya0f00670d53c0puzb2u
 */

function bytes(s) {
    return ~-encodeURI(s).split(/%..|./).length;
}

function jsonSize(s) {
    return bytes(JSON.stringify(s));
}

function saveToLocalSync(r, id) {
    const size = jsonSize(r);
    const contents = JSON.stringify({ size, ...r });
    const filename = `records/${id}.json`
    fs.writeFileSync(filename, contents);
    console.log(`Size: ${size} bytes`);
    console.log(`Kicks Size: ${jsonSize(r.kicks)} bytes`);
    console.log(`Possessions Size: ${jsonSize(r.possessions)} bytes`);
    console.log(`Positions Size: ${jsonSize(r.positions)} bytes`);
    console.log(`Wrote local record to: ${filename}`);
}

async function startProfile(page, savePrevious=false) {
    if (savePrevious) {
        const path = `./traces/${Date.now()}.json`;
        const traceData = await page.tracing.stop();
        fs.writeFileSync(path, traceData);
        console.log(`Wrote trace to: ${path}`);
    }
    await page.tracing.start();
}

async function start() {
    // Start headless browser session
    const browser = await puppeteer.launch({
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--force-fieldtrials=*BackgroundTracing/default/"
        ]
    });
    const page = await browser.newPage();
    if (roomConfig.collectTrace) {
        await startProfile(page, savePrevious=false);    
    }
    await setWindowVariables(page);
    await page.goto("https://www.haxball.com/headless", {
        waitUntil: "networkidle2"
    });
    // Handle messages
    page.on("console", function(message) {
        console.log(message.text());
    });
    page.on("pageerror", function(err) {
        console.log(`Page Error: ${err.toString()}`);
    });
    page.on("error", function(err) {
        console.log(`Error: ${err.toString()}`);
    });
    // Expose window functions
    await page.exposeFunction("loadStadium", (stadiumName) => {
        if (!(stadiumName in STADIUMS)) {
            return false;
        }
        try {
            const fileSlug = STADIUMS[stadiumName];
            const stadiumRaw = fs.readFileSync(`stadium/${fileSlug}.hbs`).toString();
            return stadiumRaw;
        } catch (err) {
            console.log(`Failed to read stadium by name: ${stadiumName}`);
            console.log(err);
            return false;
        }
    });
    await page.exposeFunction("saveGameRecord", (r, s, kicks) => {
        return new Promise((resolve, reject) => {
            console.log("\n");
            console.log(`Score: ${s.scoreRed}-${s.scoreBlue}`);
            console.log(`Time: ${s.time} secs`);
            console.log(`Players: ${r.players ? r.players.length : 0}`);
            console.log(`Kick Entries: ${r.kicks ? r.kicks.length : 0}`);
            console.log(`Possession Entries: ${r.possessions ? r.possessions.length : 0}`);
            console.log(`Position Entries: ${r.positions ? r.positions.length : 0}`);
            if (roomConfig.saveToFirebase) {
                // Write match record
                const saved = firebase.database.ServerValue.TIMESTAMP;
                const record = { ...r, saved };
                db.ref("match").push(record).then((snap) => {
                    const id = snap.key;
                    const size = jsonSize(record);
                    const summary = { ...s, id, size, saved };
                    // Write local file
                    if (roomConfig.saveToLocal) {
                        saveToLocalSync(r, id);
                    }
                    // Finish saving summary
                    db.ref(`summary/${id}`).set(summary).then(() => {
                        const kickPromises = kicks.map((kick) => {
                            const kickData = {
                                ...kick,
                                saved,
                                match: id,
                            };
                            return new Promise((resolve, reject) => {
                                db.ref(`kick`).push(kickData).then(() => {
                                    resolve({ success: true });
                                }).catch((err) => {
                                    resolve({ success: false });
                                });
                            });
                        });
                        Promise.all(kickPromises).then((kickResults) => {
                            let successCount = kickResults.reduce((agg, val) => {
                                return agg + (val.success ? 1 : 0);
                            }, 0);
                            console.log(`Saved ${successCount} / ${kickResults.length} kicks.`);
                        }).then(async () => {
                            if (roomConfig.collectTrace) {
                                await startProfile(page, savePrevious=true);
                            }
                            console.log("\n");
                            resolve(`Match ID: ${id}`);
                        }).catch(async (err) => {
                            if (roomConfig.collectTrace) {
                                await startProfile(page, savePrevious=true);
                            }
                            console.log("Error while saving kicks.");
                            console.log(err);
                            console.log("\n");
                            resolve(`Match ID: ${id}`);
                        });
                    }).catch((err) => {
                        console.log("Failed to save match summary:");
                        console.log(err);
                        console.log("\n");
                        resolve("Failed to save match summary.");
                    });
                }).catch((err) => {
                    console.log("Failed to save match data and summary:");
                    console.log(err);
                    console.log("\n");
                    resolve("Failed to save match data and summary.");
                });
            } else if (roomConfig.saveToLocal) {
                saveToLocalSync(r, id);
            } else {
                console.log("Match not saved.");
            }
        });
    });
    // Start client script
    await page.addScriptTag({ path: "hax.js" });
}

start();
console.log("Started server.");
