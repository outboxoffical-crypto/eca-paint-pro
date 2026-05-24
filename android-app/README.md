Cosvys Android module (Kotlin DSL)

This folder is a minimal Android app scaffold using Kotlin Gradle DSL. It is intended to be created inside the existing repository at `android-app/`.

What to do next

1. (Firebase was previously used but removed.) If you need Android-specific configs, add them into `android-app/app/`.

2. Generate or copy the Gradle wrapper into `android-app/` (recommended). From a system with Gradle installed you can run:

```powershell
cd D:\Cosvys\android-app
gradle wrapper --gradle-version 8.3
```

This creates `gradlew` / `gradlew.bat` and the `gradle/wrapper` folder.

3. Build the debug APK from command line:

```powershell
cd D:\Cosvys\android-app
# Windows
.\gradlew assembleDebug
# Unix
# ./gradlew assembleDebug
```

4. Open the module in Android Studio for easier editing and to run on an emulator/device:

- Open `android-app` as a project in Android Studio
- Let Android Studio sync Gradle and download dependencies
- Run the app on an emulator or device

Notes & configuration
- The project uses Kotlin 1.9.10 and example AGP/Gradle versions. You may need to adjust versions to match your environment.
- Firebase and its Gradle plugin have been removed from this module.
- If you want me to generate a full wrapper and more assets (icons, signing configs), tell me and I can provide them or the exact commands to create them locally.

