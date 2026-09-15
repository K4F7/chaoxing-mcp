import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';

final trustedLatestReleaseApi = Uri.https(
  'api.github.com',
  '/repos/K4F7/chaoxing-mcp/releases/latest',
);
final trustedReleasesPage = Uri.https(
  'github.com',
  '/K4F7/chaoxing-mcp/releases',
);

typedef CurrentBuildLoader = Future<int> Function();

class UpdateInfo {
  const UpdateInfo({required this.buildNumber, required this.releasePage});

  final int buildNumber;
  final Uri releasePage;
}

class UpdateService {
  UpdateService({http.Client? client, CurrentBuildLoader? currentBuildLoader})
    : _client = client ?? http.Client(),
      _currentBuildLoader = currentBuildLoader ?? _loadCurrentBuild;

  final http.Client _client;
  final CurrentBuildLoader _currentBuildLoader;

  Future<UpdateInfo?> check() async {
    try {
      final currentBuild = await _currentBuildLoader();
      final response = await _client.get(
        trustedLatestReleaseApi,
        headers: const {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      );
      if (response.statusCode != 200) {
        return null;
      }
      final payload = jsonDecode(response.body);
      if (payload is! Map<String, dynamic>) {
        return null;
      }
      final tag = payload['tag_name'];
      if (tag is! String) {
        return null;
      }
      final match = RegExp(r'^app-(\d+)-').firstMatch(tag);
      final latestBuild = int.tryParse(match?.group(1) ?? '');
      if (latestBuild == null || latestBuild <= currentBuild) {
        return null;
      }
      return UpdateInfo(
        buildNumber: latestBuild,
        releasePage: trustedReleasesPage,
      );
    } catch (_) {
      return null;
    }
  }
}

Future<int> _loadCurrentBuild() async {
  final info = await PackageInfo.fromPlatform();
  return int.tryParse(info.buildNumber.trim()) ?? 0;
}
