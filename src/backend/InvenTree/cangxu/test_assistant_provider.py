"""Administrator settings API isolation and credential-redaction checks."""

from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from rest_framework.test import APIRequestFactory, force_authenticate

from .assistant_gateway import RuntimeRejectedError, RuntimeUnavailableError
from .assistant_provider_api import AssistantProviderViewSet

SYNTHETIC = {
    'provider': 'openai-compatible',
    'base_url': 'http://127.0.0.1:3000/v1',
    'model_id': 'synthetic-model',
    'supports_images': False,
    'max_output_tokens': 2048,
    'timeout_ms': 180000,
}


class AssistantProviderTests(SimpleTestCase):
    """Keep secrets out of replies and reuse existing administrator status."""

    def call(self, method='get', action='list', data=None, admin=True):
        """Invoke the same view mapping used by URL routing."""
        request = getattr(APIRequestFactory(), method)(
            '/api/cangxu/assistant/provider/', data=data, format='json'
        )
        user = SimpleNamespace(
            is_authenticated=True, is_active=True, is_staff=admin, is_superuser=False
        )
        force_authenticate(request, user=user)
        return AssistantProviderViewSet.as_view({method: action})(request)

    def test_existing_administrator_required(self):
        """Ordinary authenticated users cannot see or modify shared settings."""
        with patch('cangxu.assistant_provider_api.get_runtime_transport') as get:
            for method, action in [('get', 'list'), ('put', 'save'), ('post', 'test')]:
                self.assertEqual(
                    self.call(method, action, SYNTHETIC, False).status_code, 403
                )
            get.assert_not_called()

    def test_read_and_save_filter_secrets(self):
        """Even a malformed upstream response cannot return a credential field."""
        with patch('cangxu.assistant_provider_api.get_runtime_transport') as get:
            get.return_value.provider_settings.return_value = {
                **SYNTHETIC,
                'has_api_key': True,
                'api_key': 'synthetic-secret',
            }
            response = self.call()
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('api_key', response.data)
            response = self.call('put', 'save', {**SYNTHETIC, 'api_key': ''})
            self.assertEqual(response.status_code, 200)
            self.assertNotIn('api_key', response.data)
            self.assertEqual(
                get.return_value.provider_settings.call_args.args[1]['api_key'], ''
            )

    def test_connectivity_and_failures_are_sanitized(self):
        """The model test returns only its boolean and fixed local message."""
        with patch('cangxu.assistant_provider_api.get_runtime_transport') as get:
            get.return_value.provider_settings.return_value = {
                'ok': True,
                'api_key': 'secret',
            }
            response = self.call('post', 'test', SYNTHETIC)
            self.assertEqual(response.data, {'ok': True, 'message': '连接成功'})
            for error, status in [
                (RuntimeRejectedError('secret'), 400),
                (RuntimeUnavailableError('secret'), 503),
            ]:
                get.return_value.provider_settings.side_effect = error
                response = self.call('post', 'test', SYNTHETIC)
                self.assertEqual(response.status_code, status)
                self.assertNotIn('secret', str(response.data))

    def test_reject_invalid_configuration_without_contacting_runtime(self):
        """Unknown fields and invalid limits fail at the gateway."""
        with patch('cangxu.assistant_provider_api.get_runtime_transport') as get:
            for extra in [
                {'timeout_ms': 0},
                {'max_output_tokens': 8193},
                {'partner_id': 'other'},
                {'provider': 'other'},
            ]:
                self.assertEqual(
                    self.call('put', 'save', {**SYNTHETIC, **extra}).status_code, 400
                )
            get.assert_not_called()
