# Keep Notes by Bai native Android bridges & Capacitor plugins under R8 shrinking.
-keepattributes *Annotation*,JavascriptInterface,Signature,InnerClasses

-keep class com.philipjohn.aiclassnotes.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.getcapacitor.** { *; }
-keep class com.capacitorjs.** { *; }
-dontwarn com.getcapacitor.**
-dontwarn com.capacitorjs.**
