# Yacht — mobile release & Play Store submission

This file is the checklist for going from a working debug APK to a signed,
Play-Store-ready AAB and a published listing. **Do not commit secrets.**

---

## 1. Generate the upload keystore (one time, then back up forever)

The keystore signs every release. **If you lose it, you lose the ability to
update the app on Play forever** — Google will not let you re-sign under the
same package name. Store it in a password manager AND a second offline
location (USB drive, paper backup of the password).

```bash
cd "/Users/sadiecole/Documents/YachtWallet copy/android/app"
keytool -genkey -v \
  -keystore yacht-release.keystore \
  -alias yacht \
  -keyalg RSA -keysize 2048 \
  -validity 10000

# When prompted:
#  - Keystore password: (use a strong, unique password — store in 1Password)
#  - Common Name:  Yacht Wallet
#  - Organisational Unit: (your team / your name)
#  - Organisation: Yacht
#  - City / State / Country: your details
#  - Key password: (can be same as keystore password)
```

Verify:

```bash
keytool -list -v -keystore yacht-release.keystore -alias yacht
```

## 2. Wire the keystore into Gradle (gitignored)

Create `android/keystore.properties` (at the **project**, not app, level):

```properties
storeFile=app/yacht-release.keystore
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=yacht
keyPassword=YOUR_KEY_PASSWORD
```

Add to `android/.gitignore`:

```
keystore.properties
app/yacht-release.keystore
```

`android/app/build.gradle` already reads this file — you don't need to edit
it. If `keystore.properties` is missing, release builds fall back to the
debug certificate (Play will reject any AAB signed with that cert).

## 3. Build the signed AAB

```bash
export JAVA_HOME="$HOME/.tools/jdk-21.0.11+10/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

cd "/Users/sadiecole/Documents/YachtWallet copy"
npm run sync:mobile
cd android
./gradlew bundleRelease
```

Output:

- `android/app/build/outputs/bundle/release/app-release.aab` — what you upload to Play
- `android/app/build/outputs/mapping/release/mapping.txt` — upload to Play Console for crash deobfuscation

Verify the AAB is signed with the production cert:

```bash
$ANDROID_HOME/build-tools/36.0.0/aapt2 dump badging android/app/build/outputs/bundle/release/app-release.aab 2>/dev/null | head -3
```

## 4. Bump versions for every release

In `android/app/build.gradle`:

```gradle
versionCode 3        // monotonically increases each release; Play won't
                     // accept a bundle whose code <= the last uploaded one
versionName "0.1.45" // the human-facing string shown in Play
```

Recommendation: keep `versionName` in sync with `package.json` `version`,
and bump `versionCode` by 1 every upload.

## 5. Create the Play Console app

1. https://play.google.com/console → Create app
2. Name: **Yacht** · Default language: en-US · App or game: **App** · Free or paid: **Free**
3. Accept the developer program policies + US export laws.
4. **App content** (all fields are mandatory before publishing):
   - **Privacy policy URL** — host `PRIVACY.md` somewhere public (GitHub Pages, your own domain). Link it here. Required.
   - **Data safety** form — declare that you do NOT collect or share user
     data. The wallet stores the encrypted seed locally only; RPC calls
     leak addresses to public infrastructure but are not "collected" by
     you. Recommend declaring:
     - Data collected: **None**
     - Data shared: **None**
     - Security: encrypted in transit (TLS), user can request deletion (uninstall = wipe).
   - **Financial features declaration** — Play requires this for crypto wallets:
     - "Software cryptocurrency wallet" → **Yes** (for self-custody/non-custodial)
     - You are not a custodian and never hold user funds.
   - **Ads** — No.
   - **Target audience** — 18+ (crypto wallets).
   - **Government apps** — No.
   - **News apps** — No.

## 6. Upload to Internal Testing first

1. Play Console → **Testing → Internal testing → Create new release**
2. Upload `app-release.aab`
3. Add release notes:
   ```
   First release. Self-custody ApeChain wallet with token swaps,
   NFT discovery, and on-chain chat.
   ```
4. Add internal testers (your own email is enough). Save → Review → Roll
   out to Internal testing.
5. Wait 5–15 minutes, install via the test link on your phone.

## 7. Promote to Production

When internal testing looks good:

1. Internal testing → Promote release → **Production**
2. Set rollout percentage (start at 10–20%, ramp to 100% over a week).
3. Submit for review. First-time review takes 1–7 days; expect rejection
   on the first pass for missing info — Play will email you with the
   exact field that needs editing.

---

## Crypto-wallet specific Play policy gotchas

Most rejections for self-custody wallets fall into these buckets:

- **"Misleading"** — your listing must not promise "guaranteed returns"
  or "investments." Stick to "send, receive, swap, and view your
  ApeChain assets."
- **"Financial services declaration missing"** — see step 5.
- **"Restricted permissions"** — your manifest only declares INTERNET +
  CAMERA, both justified. Don't add more without a strong reason.
- **"Backup of sensitive data"** — Play will sometimes flag wallets
  with `allowBackup="true"`. Yacht ships with `allowBackup="false"` and
  `data_extraction_rules.xml` excluding everything. ✅
- **"Insecure cryptography"** — Yacht uses Argon2id (m=64MB, t=3) +
  AES-256-GCM. Document this in the listing's "How we protect your
  funds" section if asked.
- **"Account deletion not provided"** — for non-custodial wallets, the
  uninstall is the deletion. Mention this in your support FAQ.

---

## Pre-launch checklist

Run through this before every Production release:

- [ ] `versionCode` bumped, `versionName` matches `package.json`
- [ ] `npm run test` passes
- [ ] `npm run sync:mobile` completed with no warnings
- [ ] `cd android && ./gradlew bundleRelease` produced `app-release.aab`
- [ ] Built AAB installs and unlocks on a clean (uninstalled) phone
- [ ] Send / Swap / Scan QR / NFT browse all work end-to-end on testnet
- [ ] App auto-locks on background; password is required to come back
- [ ] FLAG_SECURE working: opening the recent-apps switcher shows a
      blank thumbnail in place of the wallet
- [ ] `adb backup com.yacht.wallet` produces an empty backup
- [ ] No `console.*` calls in the bundle: `grep -c console dist-mobile/assets/*.js` should be 0
- [ ] mapping.txt uploaded to the matching Play release for crash
      symbolication

---

## Things deliberately out of scope for v1 launch

These are tracked but not blocking:

- **Biometric unlock** — useful UX upgrade, requires androidx.biometric
  + a key wrapped in Android Keystore. P2 for v0.2.
- **Hardware-backed key storage (StrongBox)** — pushes the encrypted
  vault key into the secure element on Pixel/Samsung. P2.
- **Phishing list auto-update** — fetch a signed list periodically
  instead of compile-time-baked. P2.
- **In-app dApp browser** — tabbed WebView for connecting to dApps via
  WalletConnect. Mobile dApp UX is the next big roadmap item.
- **iOS App Store** — Capacitor already produces an Xcode project; you
  need a paid Apple Developer account ($99/yr), then `npm run ios` in
  Xcode → Archive → upload to App Store Connect.
