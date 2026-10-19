// The player as the editor's Docker image builds it: the app's preview page and
// nothing else.
//
// The app's own `lib/main.dart` boots the whole app (router, sign-in, sync, saved
// theme and language) and reaches the preview through its `/preview` route. The
// preview needs none of that, so building from this file instead leaves the rest of
// the app out of the compiled player: a smaller `main.dart.js` for every teacher who
// opens the preview.
//
// It is not part of the app repository. The Dockerfile copies it to `lib/` of the
// app checkout at `PLAYER_REF` and builds with `-t lib/preview_main.dart`, so its
// imports are relative to the app's `lib/`. A rename in the app fails that build at
// the next `PLAYER_REF` bump; nothing breaks quietly.
//
// What the app's `main` and `MyApp` do that this does not, and why it is right here:
//  * restore the saved theme and language: the preview shows the default theme in
//    Czech, which is what a pupil starts with;
//  * the router and the path URL strategy: every URL under /player/ is the preview;
//  * SharedPreferences and the auth token: the preview reads and writes nothing.
// The page is framed exactly as `MyApp` frames every page (640px column).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/strings/app_strings.dart';
import 'core/strings/locale_manager.dart';
import 'core/theme/app_theme.dart';
import 'core/util/drag_scroll_behavior.dart';
import 'preview/preview_page.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // The engine reads one provider, the AI grader for open answers, and the preview
  // page overrides it with one that never answers (`preview_answer_evaluator.dart`).
  // Nothing else is read on the preview's path; the scope is there so that a
  // provider added later fails as a missing override, not as a missing ProviderScope.
  runApp(const ProviderScope(child: PreviewApp()));
}

class PreviewApp extends StatelessWidget {
  const PreviewApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppStrings.appTitle,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      locale: LocaleManager.current.toFlutterLocale(),
      scrollBehavior: const DragScrollBehavior(),
      builder: (context, child) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: child,
        ),
      ),
      home: const PreviewPage(),
    );
  }
}
