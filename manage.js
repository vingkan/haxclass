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

    `.split("\n").filter(l => l.length > 0);

    const promises = [];
    for (let i = 0; i < toDelete.length; i++) {
        const mid = toDelete[i];
        const mp = db.ref(`match/${mid}`).remove();
        const sp = db.ref(`summary/${mid}`).remove();
        promises.push(mp);
        promises.push(sp);
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
