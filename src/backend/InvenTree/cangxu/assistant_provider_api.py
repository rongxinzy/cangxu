"""Existing administrator settings for the shared assistant model provider.

Credentials pass directly to the private runtime and are never returned, logged,
or persisted in Django. Existing login and administrator status apply.
"""

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.authentication import BasicAuthentication, SessionAuthentication
from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from users.authentication import ApiTokenAuthentication

from .assistant_api import StrictSerializer
from .assistant_gateway import (
    AssistantRuntimeError,
    RuntimeProtocolError,
    RuntimeRejectedError,
    get_runtime_transport,
)


class ExistingAdministrator(BasePermission):
    """Reuse the existing staff/superuser role for deployment-wide settings."""

    message = '仅管理员可以配置模型供应商。'

    def has_permission(self, request, view):
        """Check the authenticated user's existing administrator status."""
        return bool(request.user.is_staff or request.user.is_superuser)


class ProviderInput(StrictSerializer):
    """Bound the editable provider properties without accepting identity claims."""

    provider = serializers.ChoiceField(choices=['openai-compatible'])
    base_url = serializers.CharField(max_length=2048)
    model_id = serializers.CharField(max_length=2048)
    api_key = serializers.CharField(
        max_length=4096, required=False, allow_blank=True, write_only=True
    )
    supports_images = serializers.BooleanField()
    max_output_tokens = serializers.IntegerField(min_value=1, max_value=8192)
    timeout_ms = serializers.IntegerField(min_value=1000, max_value=900000)


class ProviderUnavailable(APIException):
    """Expose no runtime transport, model credential or upstream response."""

    status_code = 503
    default_detail = '模型配置服务暂不可用。请稍后重试。'


class ProviderInvalid(APIException):
    """Give a bounded and useful validation or connectivity failure."""

    status_code = 400
    default_detail = '配置或连接测试失败。请检查接口地址、模型名称和 API Key。'


def _provider_request(method, data=None, test=False):
    """Bridge to the authenticated runtime, returning only allowed fields."""
    try:
        result = get_runtime_transport().provider_settings(method, data, test=test)
    except RuntimeRejectedError:
        raise ProviderInvalid() from None
    except AssistantRuntimeError:
        raise ProviderUnavailable() from None
    if test:
        if result.get('ok') is not True:
            raise ProviderUnavailable()
        return {'ok': True, 'message': '连接成功'}
    fields = {
        'provider': str,
        'base_url': str,
        'model_id': str,
        'supports_images': bool,
        'max_output_tokens': int,
        'timeout_ms': int,
        'has_api_key': bool,
    }
    if any(type(result.get(key)) is not kind for key, kind in fields.items()):
        raise ProviderUnavailable() from RuntimeProtocolError()
    return {key: result[key] for key in fields}


class AssistantProviderViewSet(viewsets.ViewSet):
    """Read, update and test deployment-wide provider settings."""

    authentication_classes = [
        ApiTokenAuthentication,
        BasicAuthentication,
        SessionAuthentication,
    ]
    permission_classes = [IsAuthenticated, ExistingAdministrator]

    @extend_schema(responses=dict)
    def list(self, request):
        """Return effective settings with only a key-presence flag."""
        return Response(_provider_request('GET'))

    @extend_schema(request=ProviderInput, responses=dict)
    def save(self, request):
        """Persist settings privately; an omitted or blank key is preserved."""
        serializer = ProviderInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(_provider_request('PUT', serializer.validated_data))

    @extend_schema(request=ProviderInput, responses=dict)
    def test(self, request):
        """Test temporary form values without saving or sending business data."""
        serializer = ProviderInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(_provider_request('POST', serializer.validated_data, test=True))
