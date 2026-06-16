require('dotenv').config();
const { notarize } = require("@electron/notarize");
// const { build } = require("../package.json");
// We generally shouldn't require package.json directly for build config in scripts if we can avoid it,
// but the guide uses it. However, 'build' might not be exported from package.json in a way that is clean if we just require the whole json.
// Actually require("../package.json") returns the JSON object.
const packageJson = require("../package.json");
const build = packageJson.build;

const notarizeMacos = async context => {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;
  if (process.env.SKIP_NOTARIZE === "true") {
    console.warn("Skipping notarizing step because SKIP_NOTARIZE is true.");
    return;
  }

  if (process.env.CI !== "true" && process.env.FORCE_NOTARIZE !== "true") {
    console.warn("Skipping notarizing step. Packaging is not running in CI and FORCE_NOTARIZE is not true.");
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const keychainProfile = process.env.NOTARYTOOL_KEYCHAIN_PROFILE;
  const keychain = process.env.NOTARYTOOL_KEYCHAIN;

  if (!keychainProfile && (!appleId || !appleIdPassword || !teamId)) {
    throw new Error(
      "Missing notarization credentials. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, " +
      "or set NOTARYTOOL_KEYCHAIN_PROFILE (and optional NOTARYTOOL_KEYCHAIN)."
    );
  }

  console.log("Starting notarization...");
  console.log(`  App: ${appOutDir}/${appName}.app`);
  console.log(`  Apple ID: ${appleId || "keychain-profile"}`);
  console.log(`  Team ID: ${teamId || "keychain-profile"}`);

  const notarizeOptions = {
    tool: "notarytool",
    appBundleId: build.appId,
    appPath: `${appOutDir}/${appName}.app`,
    verbose: true,
  };

  if (keychainProfile) {
    notarizeOptions.keychainProfile = keychainProfile;
    if (keychain) notarizeOptions.keychain = keychain;
  } else {
    notarizeOptions.teamId = teamId;
    notarizeOptions.appleId = appleId;
    notarizeOptions.appleIdPassword = appleIdPassword;
  }

  await notarize(notarizeOptions);
  console.log("--- notarization completed ---");
};

exports.default = notarizeMacos;
