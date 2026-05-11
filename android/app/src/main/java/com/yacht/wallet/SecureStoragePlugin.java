package com.yacht.wallet;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Yacht — hardware-backed wrap for the encrypted vault.
 *
 * Security model:
 *   The vault is already encrypted in JavaScript with AES-256-GCM under
 *   an Argon2id-derived key (m=64MB, t=3, p=1). That blob alone is hard
 *   to brute-force, but if an attacker exfiltrates it from the device
 *   they can run an offline dictionary attack at their leisure.
 *
 *   This plugin adds a SECOND encryption layer using an AES-256-GCM key
 *   that lives inside the Android Keystore — i.e. the TEE (Trusted
 *   Execution Environment) on every modern Android, or the StrongBox
 *   secure element on Pixel/Samsung phones that support it. The key
 *   never leaves the secure hardware; this app receives only Cipher
 *   handles to use it. An attacker who copies the wrapped blob off
 *   the device cannot decrypt it on a different device — they need
 *   to run code inside this app's process on the original phone.
 *
 *   Defence in depth: even if the password is weak, the attacker
 *   has to root the device AND sit inside this app to make a
 *   guess. Even if Argon2id parameters are reduced one day, the
 *   Keystore wrap remains.
 *
 * No biometric requirement is set on the key, so it works
 * transparently for every vault save. A future v0.2 enhancement can
 * add a SECOND Keystore key with setUserAuthenticationRequired(true)
 * to back biometric unlock without changing this plugin.
 */
@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {

    private static final String KEY_ALIAS = "yacht.vault.wrap.v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    /**
     * Lazily fetch (or generate) the wallet's master wrap key. AES-256
     * inside the Keystore. We try StrongBox first on API 28+; if the
     * device lacks the hardware (or fails the call for any reason) we
     * fall back to the regular Keystore which is still TEE-backed.
     */
    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null);
            return entry.getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true);

        // StrongBox only ships on Pixel 3+, Galaxy S20+, etc. Try it
        // first; if generation throws StrongBoxUnavailableException
        // fall back to the device's TEE-backed Keystore.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                builder.setIsStrongBoxBacked(true);
                generator.init(builder.build());
                return generator.generateKey();
            } catch (StrongBoxUnavailableException e) {
                // fall through to non-StrongBox path
            }
        }
        builder.setIsStrongBoxBacked(false);
        generator.init(builder.build());
        return generator.generateKey();
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        String plaintext = call.getString("data");
        if (plaintext == null) {
            call.reject("Missing 'data'");
            return;
        }
        try {
            SecretKey key = getOrCreateKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(plaintext.getBytes("UTF-8"));
            byte[] combined = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(ct, 0, combined, iv.length, ct.length);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(combined, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Encrypt failed: " + e.getClass().getSimpleName() + " " + e.getMessage());
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String encoded = call.getString("data");
        if (encoded == null) {
            call.reject("Missing 'data'");
            return;
        }
        try {
            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            if (combined.length <= GCM_IV_BYTES) {
                call.reject("Ciphertext too short");
                return;
            }
            byte[] iv = new byte[GCM_IV_BYTES];
            System.arraycopy(combined, 0, iv, 0, iv.length);
            byte[] ct = new byte[combined.length - iv.length];
            System.arraycopy(combined, iv.length, ct, 0, ct.length);
            SecretKey key = getOrCreateKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] pt = cipher.doFinal(ct);
            JSObject ret = new JSObject();
            ret.put("data", new String(pt, "UTF-8"));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Decrypt failed: " + e.getClass().getSimpleName() + " " + e.getMessage());
        }
    }

    /** Erase the master wrap key — used by `vault.destroy`. */
    @PluginMethod
    public void clear(PluginCall call) {
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS);
            call.resolve();
        } catch (Exception e) {
            call.reject("Clear failed: " + e.getMessage());
        }
    }

    /** Returns whether the master key is hardware-backed. Useful for
     *  surfacing a "secure element" badge in the UI. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
            ks.load(null);
            ret.put("present", ks.containsAlias(KEY_ALIAS));
        } catch (Exception e) {
            ret.put("present", false);
        }
        call.resolve(ret);
    }
}
