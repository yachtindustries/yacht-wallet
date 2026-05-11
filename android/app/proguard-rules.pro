# =============================================================================
# Yacht — release build R8 rules.
#
# R8 only minifies/obfuscates Java/Kotlin bytecode. The JS bundle inside
# assets/public/ is already minified by Vite/esbuild and is never touched
# by R8. The rules below preserve the classes/methods that the JS bridge
# and capacitor-mlkit/barcode-scanning reach into via reflection.
# =============================================================================

# --- Capacitor core ----------------------------------------------------------
# All registered plugins are loaded reflectively by name.
-keep public class * extends com.getcapacitor.Plugin
-keep public class com.getcapacitor.** { *; }
-keep class com.getcapacitor.BridgeActivity { *; }
-keepattributes *Annotation*

# Methods exposed to JS through @PluginMethod / @JavascriptInterface.
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod <methods>;
}
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Capacitor reads Plugin annotations off classes at runtime.
-keep @com.getcapacitor.annotation.CapacitorPlugin class *
-keep @com.getcapacitor.NativePlugin class *

# --- Plugins we ship ---------------------------------------------------------
-keep class io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.** { *; }
-keep class com.capacitorjs.plugins.preferences.** { *; }
-keep class com.capacitorjs.plugins.app.** { *; }
-keep class com.capacitorjs.plugins.statusbar.** { *; }
-keep class com.capacitorjs.plugins.splashscreen.** { *; }

# --- Google ML Kit barcode scanning ------------------------------------------
# ML Kit registers components reflectively; the optimizer can't see those
# entry points so we keep the package whole. The size cost is small (~1 MB).
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_** { *; }
-keep interface com.google.mlkit.** { *; }
-dontwarn com.google.mlkit.**

# --- AndroidX core / appcompat ------------------------------------------------
# Standard keeps already handled by proguard-android-optimize.txt;
# add anything else here on a per-issue basis if R8 reports a missing class.

# --- Reflection-friendly defaults -------------------------------------------
-keepclassmembers enum * { *; }
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# Keep stack traces useful when a release build crashes — strips file paths
# but leaves line numbers so the Play Console deobfuscation file can map
# them back. Upload the generated mapping.txt to Play after each release.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
