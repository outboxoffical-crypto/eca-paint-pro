plugins {
    // Google services plugin declaration removed because Firebase is no longer used
}

tasks.register("clean", Delete::class) {
    delete(rootProject.buildDir)
}

