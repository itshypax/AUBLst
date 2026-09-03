FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS build
WORKDIR /src
COPY server/Aublst.Api/Aublst.Api.csproj server/Aublst.Api/
RUN dotnet restore server/Aublst.Api/Aublst.Api.csproj
COPY server/Aublst.Api/ server/Aublst.Api/
COPY backend/maps/ server/Aublst.Api/maps/
RUN dotnet publish server/Aublst.Api/Aublst.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine
WORKDIR /app
COPY --from=build /app/ ./
COPY backend/maps/ ./maps/
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Aublst.Api.dll"]
